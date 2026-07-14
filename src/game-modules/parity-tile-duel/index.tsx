import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlayerSnapshot } from "../../shared/types";
import { useInteractionGate } from "../useInteractionGate";
import type {
  GameAction,
  GameActionResult,
  GameComponentProps,
  GameContext,
  GameModule,
  GameSystemAction
} from "../types";
import { BATTLEFIELDS, getBattlefield, getBattlefieldDisplay, type ParityTile } from "./battlefields";

export type ParityTilePhase = "battlefield-reveal" | "battlefield-applying" | "choose-attack" | "await-defense" | "continuation" | "round-result" | "finished";
export type BoardLocation =
  | { playerId: string; slot: "opening" }
  | { playerId: string; slot: "pair-attack"; pairIndex: number };

export interface BoardPlay {
  tile: ParityTile;
  faceDown: boolean;
}

export interface TurnPair {
  defense: BoardPlay | null;
  attack: BoardPlay | null;
}

export interface PlayerBoard {
  openingAttack: BoardPlay | null;
  pairs: TurnPair[];
}

export interface RoundSummary {
  roundNumber: number;
  winnerId: string;
  points: number;
  finishTile: ParityTile;
  reasons: string[];
  boards: Record<string, PlayerBoard>;
}

export interface ParityTileDuelState {
  playerIds: string[];
  seed: string;
  battlefieldId: string;
  battlefieldAcknowledgedPlayerIds: string[];
  targetScore: number;
  roundNumber: number;
  startPlayerId: string | null;
  activePlayerId: string | null;
  interactivePlayerIds: string[];
  attackerId: string | null;
  responderId: string | null;
  phase: ParityTilePhase;
  hands: Record<string, ParityTile[]>;
  unusedTiles: ParityTile[];
  boards: Record<string, PlayerBoard>;
  currentAttack: { tile: ParityTile; location: BoardLocation } | null;
  passedPlayerIds: string[];
  scores: Record<string, number>;
  lastRound: RoundSummary | null;
  winnerId: string | null;
  winnerIds: string[];
  attackGracePlayerId: string | null;
  attackForfeitCounts: Record<string, number>;
  roundForfeitPlayerId: string | null;
  message: string;
}

interface PublicBoardPlay {
  tile: ParityTile | null;
  hidden: boolean;
  hiddenKey?: string;
}

interface PublicPlayerBoard {
  openingAttack: PublicBoardPlay | null;
  pairs: Array<{ defense: PublicBoardPlay | null; attack: PublicBoardPlay | null }>;
}

export interface ParityTileDuelPublicState {
  playerIds: string[];
  battlefield: { id: string; name: string; description: string };
  battlefieldAcknowledgedPlayerIds: string[];
  targetScore: number;
  roundNumber: number;
  startPlayerId: string | null;
  activePlayerId: string | null;
  interactivePlayerIds: string[];
  attackerId: string | null;
  responderId: string | null;
  phase: ParityTilePhase;
  hand: ParityTile[];
  handCounts: Record<string, number>;
  boards: Record<string, PublicPlayerBoard>;
  currentAttack: { tile: ParityTile; location: BoardLocation } | null;
  passedPlayerIds: string[];
  scores: Record<string, number>;
  lastRound: Omit<RoundSummary, "boards"> | null;
  winnerId: string | null;
  winnerIds: string[];
  attackGracePlayerId: string | null;
  attackForfeitCounts: Record<string, number>;
  roundForfeitPlayerId: string | null;
  message: string;
}

const DEAL_COUNTS: Record<number, number> = { 2: 13, 3: 11, 4: 9 };

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let value = hashSeed(seed) || 0x9e3779b9;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

export function createParityTileDeck(): ParityTile[] {
  const deck: ParityTile[] = [];
  for (let value = 1; value <= 8; value += 1) {
    for (let copy = 1; copy <= value; copy += 1) {
      deck.push({ id: `number-${value}-${copy}`, kind: "number", value });
    }
  }
  deck.push({ id: "odd-special", kind: "odd-special" });
  deck.push({ id: "even-special", kind: "even-special" });
  return deck;
}

export function shuffleParityTiles(tiles: ParityTile[], seed: string) {
  const shuffled = [...tiles];
  const random = seededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function canDefend(attack: ParityTile, defense: ParityTile) {
  if (attack.kind === "number" && defense.kind === "number") return attack.value === defense.value;
  if (attack.kind === "number") {
    return attack.value! % 2 === 0 ? defense.kind === "even-special" : defense.kind === "odd-special";
  }
  if (defense.kind !== "number") return false;
  return attack.kind === "even-special" ? defense.value! % 2 === 0 : defense.value! % 2 === 1;
}

function orderedPlayerIds(players: PlayerSnapshot[]) {
  return [...players]
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat || a.joinedAt - b.joinedAt)
    .slice(0, 4)
    .map((player) => player.id);
}

function playerRecord<T>(ids: string[], create: () => T) {
  return Object.fromEntries(ids.map((id) => [id, create()])) as Record<string, T>;
}

function cloneBoards(boards: Record<string, PlayerBoard>) {
  return Object.fromEntries(
    Object.entries(boards).map(([id, board]) => [
      id,
      {
        openingAttack: board.openingAttack ? { ...board.openingAttack, tile: { ...board.openingAttack.tile } } : null,
        pairs: board.pairs.map((pair) => ({
          defense: pair.defense ? { ...pair.defense, tile: { ...pair.defense.tile } } : null,
          attack: pair.attack ? { ...pair.attack, tile: { ...pair.attack.tile } } : null
        }))
      }
    ])
  ) as Record<string, PlayerBoard>;
}

function cloneState(state: ParityTileDuelState): ParityTileDuelState {
  return {
    ...state,
    playerIds: [...state.playerIds],
    battlefieldAcknowledgedPlayerIds: [...state.battlefieldAcknowledgedPlayerIds],
    interactivePlayerIds: [...state.interactivePlayerIds],
    hands: Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, hand.map((tile) => ({ ...tile }))])),
    unusedTiles: state.unusedTiles.map((tile) => ({ ...tile })),
    boards: cloneBoards(state.boards),
    currentAttack: state.currentAttack
      ? { tile: { ...state.currentAttack.tile }, location: { ...state.currentAttack.location } }
      : null,
    passedPlayerIds: [...state.passedPlayerIds],
    scores: { ...state.scores },
    winnerIds: [...state.winnerIds],
    attackForfeitCounts: { ...state.attackForfeitCounts },
    lastRound: state.lastRound
      ? { ...state.lastRound, finishTile: { ...state.lastRound.finishTile }, reasons: [...state.lastRound.reasons], boards: cloneBoards(state.lastRound.boards) }
      : null
  };
}

function nextPlayer(state: Pick<ParityTileDuelState, "playerIds">, playerId: string) {
  const index = state.playerIds.indexOf(playerId);
  return state.playerIds[(index + 1 + state.playerIds.length) % state.playerIds.length] ?? null;
}

function sortTiles(tiles: ParityTile[]) {
  return [...tiles].sort((a, b) => {
    const aRank = a.kind === "number" ? a.value! : a.kind === "odd-special" ? 9 : 10;
    const bRank = b.kind === "number" ? b.value! : b.kind === "odd-special" ? 9 : 10;
    return aRank - bRank || a.id.localeCompare(b.id);
  });
}

function setupRound(state: ParityTileDuelState, roundNumber: number, startPlayerId: string): ParityTileDuelState {
  const deck = shuffleParityTiles(createParityTileDeck(), `${state.seed}:round:${roundNumber}`);
  const baseCount = DEAL_COUNTS[state.playerIds.length] ?? 9;
  const hands = playerRecord(state.playerIds, () => [] as ParityTile[]);
  let cursor = 0;
  for (const playerId of state.playerIds) {
    const count = baseCount + (playerId === startPlayerId ? 1 : 0);
    hands[playerId] = sortTiles(deck.slice(cursor, cursor + count));
    cursor += count;
  }
  return {
    ...state,
    roundNumber,
    startPlayerId,
    activePlayerId: startPlayerId,
    interactivePlayerIds: [startPlayerId],
    attackerId: startPlayerId,
    responderId: null,
    phase: "choose-attack",
    hands,
    unusedTiles: deck.slice(cursor),
    boards: playerRecord(state.playerIds, () => ({ openingAttack: null, pairs: [] })),
    currentAttack: null,
    passedPlayerIds: [],
    attackGracePlayerId: null,
    roundForfeitPlayerId: null,
    message: `${roundNumber}라운드입니다. 시작 플레이어가 첫 공격을 고릅니다.`
  };
}

function createState(context: Pick<GameContext, "players" | "rngSeed">): ParityTileDuelState {
  const playerIds = orderedPlayerIds(context.players);
  const seed = context.rngSeed ?? `parity-tile-${playerIds.join("-")}`;
  const startPlayerId = playerIds[hashSeed(`${seed}:starter`) % Math.max(playerIds.length, 1)] ?? null;
  const fixture = BATTLEFIELDS[hashSeed(`${seed}:battlefield`) % BATTLEFIELDS.length];
  const base: ParityTileDuelState = {
    playerIds,
    seed,
    battlefieldId: fixture.id,
    battlefieldAcknowledgedPlayerIds: [],
    targetScore: 10,
    roundNumber: 1,
    startPlayerId,
    activePlayerId: startPlayerId,
    interactivePlayerIds: startPlayerId ? [startPlayerId] : [],
    attackerId: startPlayerId,
    responderId: null,
    phase: startPlayerId ? "choose-attack" : "finished",
    hands: playerRecord(playerIds, () => []),
    unusedTiles: [],
    boards: playerRecord(playerIds, () => ({ openingAttack: null, pairs: [] })),
    currentAttack: null,
    passedPlayerIds: [],
    scores: playerRecord(playerIds, () => 0),
    lastRound: null,
    winnerId: null,
    winnerIds: [],
    attackGracePlayerId: null,
    attackForfeitCounts: playerRecord(playerIds, () => 0),
    roundForfeitPlayerId: null,
    message: startPlayerId ? "첫 공격을 준비합니다." : "플레이어가 부족합니다."
  };
  if (!startPlayerId) return base;
  const prepared = setupRound(base, 1, startPlayerId);
  return {
    ...prepared,
    activePlayerId: null,
    interactivePlayerIds: [...playerIds],
    phase: "battlefield-reveal",
    message: "이번 대결의 전장이 공개됩니다. 환경 효과를 확인해주세요."
  };
}

function tileFromAction(action: GameAction, key = "tileId") {
  if (!action.payload || typeof action.payload !== "object" || !(key in action.payload)) return null;
  const value = (action.payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function takeTile(state: ParityTileDuelState, playerId: string, tileId: string) {
  const hand = state.hands[playerId] ?? [];
  const index = hand.findIndex((tile) => tile.id === tileId);
  if (index < 0) return null;
  const [tile] = hand.splice(index, 1);
  return tile;
}

function placeAttack(state: ParityTileDuelState, playerId: string, tile: ParityTile): BoardLocation | null {
  const board = state.boards[playerId];
  if (!board) return null;
  for (let pairIndex = board.pairs.length - 1; pairIndex >= 0; pairIndex -= 1) {
    if (!board.pairs[pairIndex].attack) {
      board.pairs[pairIndex].attack = { tile, faceDown: false };
      return { playerId, slot: "pair-attack", pairIndex };
    }
  }
  if (!board.openingAttack) {
    board.openingAttack = { tile, faceDown: false };
    return { playerId, slot: "opening" };
  }
  return null;
}

function startResponse(state: ParityTileDuelState, attackerId: string, tile: ParityTile, location: BoardLocation) {
  const responderId = nextPlayer(state, attackerId);
  state.currentAttack = { tile, location };
  state.attackerId = attackerId;
  state.responderId = responderId;
  state.activePlayerId = responderId;
  state.interactivePlayerIds = responderId ? [responderId] : [];
  state.passedPlayerIds = [];
  state.phase = "await-defense";
  state.message = "현재 공격을 막거나 패스하세요.";
}

function publicTile(play: BoardPlay | null, hiddenKey: string, revealHidden: boolean): PublicBoardPlay | null {
  if (!play) return null;
  return play.faceDown && !revealHidden ? { tile: null, hidden: true, hiddenKey } : { tile: play.tile, hidden: false };
}

function publicBoard(board: PlayerBoard, playerId: string, revealHidden: boolean): PublicPlayerBoard {
  return {
    openingAttack: publicTile(board.openingAttack, `${playerId}:opening`, revealHidden),
    pairs: board.pairs.map((pair, index) => ({
      defense: publicTile(pair.defense, `${playerId}:bonus:${index}`, revealHidden),
      attack: publicTile(pair.attack, `${playerId}:attack:${index}`, revealHidden)
    }))
  };
}

function publicState(state: ParityTileDuelState, viewerId: string | null): ParityTileDuelPublicState {
  const battlefield = getBattlefield(state.battlefieldId);
  const battlefieldDisplay = getBattlefieldDisplay(battlefield, state.playerIds.length);
  return {
    playerIds: [...state.playerIds],
    battlefield: { id: battlefield.id, name: battlefield.name, description: battlefieldDisplay.description },
    battlefieldAcknowledgedPlayerIds: [...state.battlefieldAcknowledgedPlayerIds],
    targetScore: state.targetScore,
    roundNumber: state.roundNumber,
    startPlayerId: state.startPlayerId,
    activePlayerId: state.activePlayerId,
    interactivePlayerIds: [...state.interactivePlayerIds],
    attackerId: state.attackerId,
    responderId: state.responderId,
    phase: state.phase,
    hand: viewerId && state.playerIds.includes(viewerId) ? state.hands[viewerId].map((tile) => ({ ...tile })) : [],
    handCounts: Object.fromEntries(state.playerIds.map((id) => [id, state.hands[id]?.length ?? 0])),
    boards: Object.fromEntries(
      state.playerIds.map((id) => [id, publicBoard(state.boards[id], id, state.phase === "round-result" || state.phase === "finished")])
    ),
    currentAttack: state.currentAttack
      ? { tile: { ...state.currentAttack.tile }, location: { ...state.currentAttack.location } }
      : null,
    passedPlayerIds: [...state.passedPlayerIds],
    scores: { ...state.scores },
    lastRound: state.lastRound
      ? {
          roundNumber: state.lastRound.roundNumber,
          winnerId: state.lastRound.winnerId,
          points: state.lastRound.points,
          finishTile: { ...state.lastRound.finishTile },
          reasons: [...state.lastRound.reasons]
        }
      : null,
    winnerId: state.winnerId,
    winnerIds: [...state.winnerIds],
    attackGracePlayerId: state.attackGracePlayerId,
    attackForfeitCounts: { ...state.attackForfeitCounts },
    roundForfeitPlayerId: state.roundForfeitPlayerId,
    message: state.message
  };
}

function result(state: ParityTileDuelState, context: GameContext, log?: string): GameActionResult {
  return {
    state,
    log,
    activePlayerId: state.activePlayerId,
    interactivePlayerIds: [...state.interactivePlayerIds],
    turnNumber: context.turnNumber + 1,
    roundNumber: state.roundNumber,
    phase: state.phase,
    message: state.message,
    winnerId: state.winnerId,
    winnerIds: state.winnerIds,
    resetTimer: state.phase !== "finished"
  };
}

function rejected(_state: ParityTileDuelState, message: string): never {
  throw new Error(message);
}

function finishRound(state: ParityTileDuelState, winnerId: string, finishTile: ParityTile, winnerName: string) {
  const battlefield = getBattlefield(state.battlefieldId);
  const bonusCount = state.boards[winnerId].pairs.filter((pair) => pair.defense?.faceDown).length;
  const score = battlefield.score(finishTile, bonusCount, state.playerIds.length);
  state.scores[winnerId] = (state.scores[winnerId] ?? 0) + score.points;
  state.lastRound = {
    roundNumber: state.roundNumber,
    winnerId,
    points: score.points,
    finishTile: { ...finishTile },
    reasons: score.reasons,
    boards: cloneBoards(state.boards)
  };

  if (state.scores[winnerId] >= state.targetScore) {
    state.phase = "finished";
    state.winnerId = winnerId;
    state.winnerIds = [winnerId];
    state.activePlayerId = null;
    state.interactivePlayerIds = [];
    state.attackerId = null;
    state.responderId = null;
    state.message = `${score.points}점을 얻어 대결에서 승리했습니다.`;
    return;
  }

  state.phase = "round-result";
  state.activePlayerId = null;
  state.interactivePlayerIds = [];
  state.attackerId = null;
  state.responderId = null;
  state.attackGracePlayerId = null;
  state.roundForfeitPlayerId = null;
  state.message = `${winnerName}님이 ${score.points}점을 얻었습니다. 잠시 후 다음 공방을 시작합니다.`;
}

function forfeitAttackRound(state: ParityTileDuelState, playerId: string, playerName: string) {
  const count = (state.attackForfeitCounts[playerId] ?? 0) + 1;
  state.attackForfeitCounts[playerId] = count;
  state.attackGracePlayerId = null;
  state.activePlayerId = null;
  state.interactivePlayerIds = [];
  state.attackerId = null;
  state.responderId = null;
  state.roundForfeitPlayerId = playerId;
  state.lastRound = null;
  if (count >= 2) {
    state.phase = "finished";
    state.winnerIds = state.playerIds.filter((id) => id !== playerId);
    state.winnerId = state.winnerIds[0] ?? null;
    state.message = `${playerName}님이 공격 시간 초과를 두 번 기록해 매치에서 몰수패했습니다.`;
    return;
  }
  state.phase = "round-result";
  state.message = `${playerName}님이 공격 유예 시간까지 넘겨 이번 공방을 몰수했습니다. 점수 없이 다음 공방으로 이동합니다.`;
}

function performAction(current: ParityTileDuelState, action: GameAction, context: GameContext): GameActionResult {
  if (current.phase === "finished") return rejected(current, "이미 끝난 대결입니다.");
  const actorId = context.currentPlayerId;
  const actorName = context.players.find((player) => player.id === actorId)?.name ?? "플레이어";
  if (current.phase === "battlefield-reveal") {
    if (action.type !== "tile/acknowledge-battlefield" || !current.playerIds.includes(actorId)) {
      return rejected(current, "전장 환경을 먼저 확인해주세요.");
    }
    if (current.battlefieldAcknowledgedPlayerIds.includes(actorId)) {
      return rejected(current, "이미 전장 환경을 확인했습니다.");
    }
    const state = cloneState(current);
    state.battlefieldAcknowledgedPlayerIds.push(actorId);
    const pendingPlayerIds = state.playerIds.filter((id) => !state.battlefieldAcknowledgedPlayerIds.includes(id));
    if (pendingPlayerIds.length === 0) {
      state.activePlayerId = null;
      state.interactivePlayerIds = [];
      state.phase = "battlefield-applying";
      state.message = "모두 환경을 확인했습니다. 전장 환경을 게임판에 적용 중입니다.";
      return result(state, context, "전장 환경 적용 시작");
    }
    state.activePlayerId = null;
    state.interactivePlayerIds = pendingPlayerIds;
    state.message = `${actorName}님이 환경을 확인했습니다. 다른 플레이어를 기다립니다.`;
    return result(state, context, "전장 환경 확인");
  }
  if (actorId !== current.activePlayerId || !current.playerIds.includes(actorId)) {
    return rejected(current, "현재 행동할 차례가 아닙니다.");
  }
  const state = cloneState(current);
  state.attackGracePlayerId = null;

  if (action.type === "tile/attack") {
    if (state.phase !== "choose-attack" || actorId !== state.attackerId) return rejected(current, "지금은 공격 단계가 아닙니다.");
    const tileId = tileFromAction(action);
    if (!tileId) return rejected(current, "공격할 타일을 골라주세요.");
    const tile = takeTile(state, actorId, tileId);
    if (!tile) return rejected(current, "내 손에 없는 타일입니다.");
    const location = placeAttack(state, actorId, tile);
    if (!location) return rejected(current, "공격 타일을 놓을 빈 칸이 없습니다.");
    if (state.hands[actorId].length === 0) {
      state.currentAttack = { tile, location };
      finishRound(state, actorId, tile, actorName);
    }
    else startResponse(state, actorId, tile, location);
    return result(state, context, `${tileLabel(tile)} 공격`);
  }

  if (action.type === "tile/defend") {
    if (state.phase !== "await-defense" || actorId !== state.responderId || !state.currentAttack) {
      return rejected(current, "지금은 방어할 수 없습니다.");
    }
    const tileId = tileFromAction(action);
    if (!tileId) return rejected(current, "방어할 타일을 골라주세요.");
    const candidate = state.hands[actorId]?.find((tile) => tile.id === tileId);
    if (!candidate) return rejected(current, "내 손에 없는 타일입니다.");
    if (!canDefend(state.currentAttack.tile, candidate)) return rejected(current, "현재 공격과 맞지 않는 타일입니다.");
    const tile = takeTile(state, actorId, tileId)!;
    state.boards[actorId].pairs.push({ defense: { tile, faceDown: false }, attack: null });
    if (state.hands[actorId].length === 0) {
      finishRound(state, actorId, tile, actorName);
    } else {
      state.attackerId = actorId;
      state.responderId = null;
      state.activePlayerId = actorId;
      state.interactivePlayerIds = [actorId];
      state.currentAttack = null;
      state.passedPlayerIds = [];
      state.phase = "choose-attack";
      state.message = "방어에 성공했습니다. 이어서 새 공격을 고르세요.";
    }
    return result(state, context, `${tileLabel(tile)} 방어`);
  }

  if (action.type === "tile/pass") {
    if (state.phase !== "await-defense" || actorId !== state.responderId || !state.attackerId) {
      return rejected(current, "지금은 패스할 수 없습니다.");
    }
    if (!state.passedPlayerIds.includes(actorId)) state.passedPlayerIds.push(actorId);
    if (state.passedPlayerIds.length >= state.playerIds.length - 1) {
      state.phase = "continuation";
      state.responderId = null;
      state.activePlayerId = state.attackerId;
      state.interactivePlayerIds = [state.attackerId];
      state.message = "모두 패스했습니다. 보너스를 묻고 새 공격을 이어가세요.";
    } else {
      let responder = nextPlayer(state, actorId);
      while (responder && (responder === state.attackerId || state.passedPlayerIds.includes(responder))) {
        responder = nextPlayer(state, responder);
      }
      state.responderId = responder;
      state.activePlayerId = responder;
      state.interactivePlayerIds = responder ? [responder] : [];
      state.message = "다음 플레이어가 방어하거나 패스할 차례입니다.";
    }
    return result(state, context, "패스");
  }

  if (action.type === "tile/continue") {
    if (state.phase !== "continuation" || actorId !== state.attackerId) return rejected(current, "지금은 연속 공격 단계가 아닙니다.");
    const attackId = tileFromAction(action, "attackTileId");
    const bonusId = tileFromAction(action, "bonusTileId");
    const hand = state.hands[actorId] ?? [];
    if (!attackId) return rejected(current, "새 공격 타일을 골라주세요.");
    if (hand.length === 1 && bonusId) return rejected(current, "마지막 한 장은 보너스로 묻을 수 없습니다.");
    if (hand.length >= 2 && (!bonusId || bonusId === attackId)) return rejected(current, "서로 다른 보너스와 공격 타일을 골라주세요.");
    const attackCandidate = hand.find((tile) => tile.id === attackId);
    const bonusCandidate = bonusId ? hand.find((tile) => tile.id === bonusId) : null;
    if (!attackCandidate || (bonusId && !bonusCandidate)) return rejected(current, "내 손에 없는 타일이 포함되어 있습니다.");
    const bonus = bonusId ? takeTile(state, actorId, bonusId) : null;
    const attack = takeTile(state, actorId, attackId)!;
    const pairIndex = state.boards[actorId].pairs.length;
    state.boards[actorId].pairs.push({
      defense: bonus ? { tile: bonus, faceDown: true } : null,
      attack: { tile: attack, faceDown: false }
    });
    if (state.hands[actorId].length === 0) {
      state.currentAttack = { tile: attack, location: { playerId: actorId, slot: "pair-attack", pairIndex } };
      finishRound(state, actorId, attack, actorName);
    }
    else startResponse(state, actorId, attack, { playerId: actorId, slot: "pair-attack", pairIndex });
    return result(state, context, "연속 공격");
  }

  return rejected(current, "지원하지 않는 타이거 앤 드래곤 행동입니다.");
}

export function tileLabel(tile: ParityTile | null) {
  if (!tile) return "빈 칸";
  if (tile.kind === "odd-special") return "용 특수 타일";
  if (tile.kind === "even-special") return "호랑이 특수 타일";
  return `숫자 ${tile.value} 타일`;
}

export const module: GameModule = {
  id: "parity-tile-duel",
  concurrencyMode: "strict",
  timerMode: "phase",
  getTimerDurationMs: (state) => {
    const parityState = state as ParityTileDuelState;
    const phase = parityState.phase;
    if (phase === "finished" || phase === "battlefield-reveal") return null;
    if (phase === "battlefield-applying") return 800;
    if (phase === "round-result") return 2_500;
    if (phase === "await-defense") return 25_000;
    return parityState.attackGracePlayerId === parityState.activePlayerId ? 20_000 : 40_000;
  },
  createInitialState: createState,
  getPublicState: (state, context) => publicState(state as ParityTileDuelState, context.viewerId),
  applyAction: (state, action, context) => performAction(state as ParityTileDuelState, action, context),
  applySystemAction: (state, action: GameSystemAction, context) => {
    const current = state as ParityTileDuelState;
    if (current.phase === "battlefield-applying") {
      if (action.type !== "system/timeout") return rejected(current, "전장 환경 적용이 끝날 때까지 기다려주세요.");
      const next = cloneState(current);
      next.activePlayerId = next.startPlayerId;
      next.interactivePlayerIds = next.startPlayerId ? [next.startPlayerId] : [];
      next.phase = "choose-attack";
      next.message = "전장 환경 적용을 마쳤습니다. 시작 플레이어가 첫 공격을 고릅니다.";
      return result(next, context, "전장 환경 적용 완료");
    }
    if (current.phase === "round-result") {
      const next = cloneState(current);
      const winnerId = next.lastRound?.winnerId ?? next.startPlayerId ?? next.playerIds[0];
      const nextStart = nextPlayer(next, next.startPlayerId ?? winnerId) ?? winnerId;
      Object.assign(next, setupRound(next, next.roundNumber + 1, nextStart));
      next.message = `${next.roundNumber}라운드입니다. 시작 플레이어가 첫 공격을 고릅니다.`;
      return result(next, context, "다음 공방 시작");
    }
    if (current.phase === "finished" || current.activePlayerId !== context.currentPlayerId) return rejected(current, "자동 행동 대상이 아닙니다.");
    if (current.phase === "await-defense") {
      return performAction(current, { type: "tile/pass" }, context);
    }
    if (current.phase === "choose-attack" || current.phase === "continuation") {
      const next = cloneState(current);
      const playerName = context.players.find((player) => player.id === context.currentPlayerId)?.name ?? "플레이어";
      if (next.attackGracePlayerId !== context.currentPlayerId) {
        next.attackGracePlayerId = context.currentPlayerId;
        next.message = `${playerName}님의 공격 시간이 끝났습니다. 마지막 20초 유예가 시작됩니다.`;
        return result(next, context, "공격 시간 초과 유예 시작");
      }
      forfeitAttackRound(next, context.currentPlayerId, playerName);
      return result(next, context, "공격 시간 초과 공방 몰수");
    }
    return rejected(current, action.type === "system/timeout" ? "시간초과 행동을 적용할 수 없습니다." : "자동 행동을 적용할 수 없습니다.");
  }
};

function getPlayerName(players: PlayerSnapshot[], id: string | null) {
  if (!id) return "대기 중";
  return players.find((player) => player.id === id)?.name ?? "플레이어";
}

function TigerCrest({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 24 10 9l14 8M50 24l4-15-14 8M18 22c4-7 10-10 14-10s10 3 14 10l4 11c2 10-6 22-18 22S12 43 14 33l4-11Z" />
      <path d="M24 27c3-2 5-2 8 0 3-2 5-2 8 0M25 36h14l-7 8-7-8ZM19 31l9 2M45 31l-9 2M21 20l7 6M43 20l-7 6" />
    </svg>
  );
}

function DragonCrest({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M13 42c5 9 20 10 29 3 8-6 8-17 2-22-5-5-13-4-17 1-4 5-1 12 5 12 5 0 8-5 6-9" />
      <path d="m38 18 2-9 6 8 9-2-4 8 6 6-9 1M15 42 7 38l5-5-5-6 9 1M21 47l-3 8 8-4 6 5 1-9M43 39l9 4-2-9" />
      <circle cx="43" cy="23" r="1.8" />
    </svg>
  );
}

const BATTLEFIELD_PRESENTATION: Record<string, { glyph: string; eyebrow: string; atmosphere: string }> = {
  "balance-hall": {
    glyph: "균",
    eyebrow: "대칭 전장",
    atmosphere: "호랑이와 용의 힘이 팽팽히 맞서는 회랑입니다. 어느 계열로 마무리할지 손패를 끝까지 조율하세요."
  },
  "patient-kiln": {
    glyph: "화",
    eyebrow: "축적 전장",
    atmosphere: "불씨를 오래 지킬수록 강해지는 가마입니다. 한 바퀴 패스를 유도해 보너스를 쌓는 운영이 중요합니다."
  },
  "high-window": {
    glyph: "창",
    eyebrow: "고점 전장",
    atmosphere: "높은 수가 빛을 받는 공방입니다. 강한 숫자를 지키되 상대에게 마무리 기회를 내주지 마세요."
  }
};

const TILE_ART = {
  tigerNumber: "/board-assets/tiger-dragon-tiles/tiger-number.svg",
  dragonNumber: "/board-assets/tiger-dragon-tiles/dragon-number.svg",
  tigerSpecial: "/board-assets/tiger-dragon-tiles/tiger-special.svg",
  dragonSpecial: "/board-assets/tiger-dragon-tiles/dragon-special.svg",
  back: "/board-assets/tiger-dragon-tiles/tile-back.svg"
} as const;

function TileFace({ tile, hidden = false, compact = false }: { tile: ParityTile | null; hidden?: boolean; compact?: boolean }) {
  const empty = !tile && !hidden;
  const family = tile?.kind === "number" ? (tile.value! % 2 === 0 ? "tiger" : "dragon") : tile?.kind === "even-special" ? "tiger" : "dragon";
  const special = tile?.kind === "even-special" ? "tiger" : tile?.kind === "odd-special" ? "dragon" : null;
  const artSource = empty
    ? null
    : hidden
    ? TILE_ART.back
    : special === "tiger"
      ? TILE_ART.tigerSpecial
      : special === "dragon"
        ? TILE_ART.dragonSpecial
        : family === "tiger"
          ? TILE_ART.tigerNumber
          : TILE_ART.dragonNumber;
  return (
    <span className={`ptd-tile ${empty ? "empty" : family} ${special ? "special" : ""} ${hidden ? "hidden" : ""} ${compact ? "compact" : ""}`} aria-label={hidden ? "뒷면 보너스 타일" : tileLabel(tile)}>
      {artSource ? <img className="ptd-tile-art" src={artSource} alt="" aria-hidden="true" draggable={false} /> : null}
      {empty || hidden || special ? <small>{empty ? "대기" : hidden ? "보너스" : special === "tiger" ? "호랑이" : "용"}</small> : null}
      {empty ? <strong aria-hidden="true">—</strong> : hidden ? <strong>?</strong> : special ? null : <strong>{tile?.value}</strong>}
    </span>
  );
}

function DefenseGuide() {
  return (
    <aside className="ptd-defense-guide" aria-label="타일 방어 규칙">
      <strong>공격을 막을 때 낼 수 있는 타일</strong>
      <span className="number-pair">같은 숫자끼리</span>
      <span className="tiger-pair"><TigerCrest /><b>호랑이</b><i aria-hidden="true">↔</i>2·4·6·8</span>
      <span className="dragon-pair"><DragonCrest /><b>용</b><i aria-hidden="true">↔</i>1·3·5·7</span>
    </aside>
  );
}

export function Component({ players, currentPlayer, publicState: state, disabled, onAction }: GameComponentProps<ParityTileDuelPublicState>) {
  const myId = currentPlayer?.id ?? null;
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [bonusTileId, setBonusTileId] = useState<string | null>(null);
  const [continuationStep, setContinuationStep] = useState<"bonus" | "attack">("bonus");
  const [battlefieldInfoOpen, setBattlefieldInfoOpen] = useState(false);
  const [battlefieldRevealReady, setBattlefieldRevealReady] = useState(false);
  const [battlefieldRevealSessionOpen, setBattlefieldRevealSessionOpen] = useState(
    state.phase === "battlefield-reveal" || state.phase === "battlefield-applying"
  );
  const battlefieldDialogRef = useRef<HTMLElement | null>(null);
  const battlefieldDialogActionRef = useRef<HTMLButtonElement | null>(null);
  const battlefieldSealRef = useRef<HTMLButtonElement | null>(null);
  const battlefieldReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const battlefieldFocusFrameRef = useRef<number | null>(null);
  const previousBattlefieldPhaseRef = useRef<ParityTilePhase>(state.phase);
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [state.phase, state.activePlayerId, state.roundNumber, state.hand.length, state.currentAttack?.tile.id, state.battlefieldAcknowledgedPlayerIds.length],
    { cooldownMs: 500 }
  );

  useEffect(() => {
    setSelectedTileId(null);
    setBonusTileId(null);
    setContinuationStep("bonus");
  }, [state.phase, state.activePlayerId, state.roundNumber, state.hand.length]);

  const isInitialBattlefieldReveal = state.phase === "battlefield-reveal";
  const isBattlefieldApplying = state.phase === "battlefield-applying";
  const showBattlefieldDialog = battlefieldRevealSessionOpen || battlefieldInfoOpen;
  const isBattlefieldRevealDialog = battlefieldRevealSessionOpen;
  const battlefieldRevealComplete = !isInitialBattlefieldReveal || battlefieldRevealReady;
  const hasAcknowledgedBattlefield = Boolean(myId && state.battlefieldAcknowledgedPlayerIds.includes(myId));
  const canAcknowledgeBattlefield = Boolean(
    myId &&
    state.playerIds.includes(myId) &&
    !hasAcknowledgedBattlefield &&
    !disabled &&
    !isSubmitting
  );

  const openBattlefieldInfo = (trigger: HTMLButtonElement) => {
    battlefieldReturnFocusRef.current = trigger;
    setBattlefieldInfoOpen(true);
  };

  const scheduleBattlefieldFocus = (target: () => HTMLElement | null | undefined) => {
    if (battlefieldFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(battlefieldFocusFrameRef.current);
    }
    battlefieldFocusFrameRef.current = window.requestAnimationFrame(() => {
      battlefieldFocusFrameRef.current = null;
      target()?.focus();
    });
  };

  const closeBattlefieldInfo = () => {
    setBattlefieldInfoOpen(false);
    const trigger = battlefieldReturnFocusRef.current;
    scheduleBattlefieldFocus(() => trigger);
  };

  useEffect(() => () => {
    if (battlefieldFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(battlefieldFocusFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const previousPhase = previousBattlefieldPhaseRef.current;
    previousBattlefieldPhaseRef.current = state.phase;

    if (state.phase === "battlefield-reveal" || state.phase === "battlefield-applying") {
      setBattlefieldRevealSessionOpen(true);
      return;
    }
    if (previousPhase === "battlefield-applying" && battlefieldRevealSessionOpen) {
      setBattlefieldRevealSessionOpen(false);
      scheduleBattlefieldFocus(() => battlefieldSealRef.current);
    }
  }, [battlefieldRevealSessionOpen, state.phase]);

  useEffect(() => {
    if (!isInitialBattlefieldReveal) {
      setBattlefieldRevealReady(true);
      return;
    }
    setBattlefieldRevealReady(false);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setBattlefieldRevealReady(true);
      return;
    }
    const timer = window.setTimeout(() => setBattlefieldRevealReady(true), 1_450);
    return () => window.clearTimeout(timer);
  }, [isInitialBattlefieldReveal, state.battlefield.id]);

  useLayoutEffect(() => {
    if (!showBattlefieldDialog) return;

    const dialog = battlefieldDialogRef.current;
    const portalRoot = dialog?.closest<HTMLElement>("[data-ptd-battlefield-portal]") ?? null;
    dialog?.focus({ preventScroll: true });

    const previousBackgroundState = new Map<HTMLElement, { hadInert: boolean; ariaHidden: string | null }>();
    const previousBodyOverflow = document.body.style.overflow;

    const protectBackgroundElement = (element: HTMLElement) => {
      if (
        element === portalRoot ||
        element.tagName === "SCRIPT" ||
        element.tagName === "STYLE"
      ) {
        return;
      }
      if (!previousBackgroundState.has(element)) {
        previousBackgroundState.set(element, {
          hadInert: element.hasAttribute("inert"),
          ariaHidden: element.getAttribute("aria-hidden")
        });
      }
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    };

    for (const element of Array.from(document.body.children)) {
      if (element instanceof HTMLElement) protectBackgroundElement(element);
    }

    const backgroundObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const addedNode of Array.from(record.addedNodes)) {
          if (addedNode instanceof HTMLElement) protectBackgroundElement(addedNode);
        }
      }
    });
    backgroundObserver.observe(document.body, { childList: true });

    const keepFocusInPortal = (event: FocusEvent) => {
      if (!portalRoot || portalRoot.contains(event.target as Node)) return;
      dialog?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", keepFocusInPortal, true);
    document.body.style.overflow = "hidden";

    return () => {
      backgroundObserver.disconnect();
      document.removeEventListener("focusin", keepFocusInPortal, true);
      for (const [element, { hadInert, ariaHidden }] of previousBackgroundState) {
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [showBattlefieldDialog]);

  useEffect(() => {
    if (!showBattlefieldDialog || !battlefieldRevealComplete) return;
    const action = battlefieldDialogActionRef.current;
    if (action && !action.disabled) action.focus();
    else battlefieldDialogRef.current?.focus();
  }, [battlefieldRevealComplete, isBattlefieldApplying, showBattlefieldDialog]);

  useEffect(() => {
    if (!showBattlefieldDialog || !isBattlefieldRevealDialog || !hasAcknowledgedBattlefield) return;
    scheduleBattlefieldFocus(() => battlefieldDialogRef.current);
  }, [hasAcknowledgedBattlefield, isBattlefieldRevealDialog, showBattlefieldDialog]);

  useEffect(() => {
    if (!showBattlefieldDialog) return;
    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key === "Escape" && battlefieldInfoOpen && !isInitialBattlefieldReveal) {
        closeBattlefieldInfo();
        return;
      }
      if (event.key !== "Tab" || !battlefieldDialogRef.current) return;
      const focusable = Array.from(
        battlefieldDialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")
      );
      if (focusable.length === 0) {
        event.preventDefault();
        battlefieldDialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keepFocusInDialog);
    return () => window.removeEventListener("keydown", keepFocusInDialog);
  }, [battlefieldInfoOpen, isInitialBattlefieldReveal, showBattlefieldDialog]);

  const myTurn = Boolean(myId && state.activePlayerId === myId && state.interactivePlayerIds.includes(myId));
  const selectedTile = state.hand.find((tile) => tile.id === selectedTileId) ?? null;
  const canUseSelectedForDefense = Boolean(selectedTile && state.currentAttack && canDefend(state.currentAttack.tile, selectedTile));
  const controlsDisabled = disabled || !myTurn || isSubmitting || isBattlefieldApplying;
  const battlefield = state.battlefield;
  const fieldPresentation = BATTLEFIELD_PRESENTATION[battlefield.id] ?? BATTLEFIELD_PRESENTATION["balance-hall"];
  const battlefieldDisplay = getBattlefieldDisplay(getBattlefield(battlefield.id), state.playerIds.length);
  const showRoundOutcome = Boolean(state.lastRound && state.phase === "round-result");
  const showOutcomePanel = state.phase === "round-result" || state.phase === "finished";
  const outcomeWinnerNames = state.phase === "finished"
    ? state.winnerIds.map((id) => getPlayerName(players, id)).join(", ")
    : state.lastRound
      ? getPlayerName(players, state.lastRound.winnerId)
      : "결과 집계 중";

  const chooseTile = (tileId: string) => {
    if (state.phase !== "continuation") {
      setSelectedTileId(tileId);
      return;
    }
    if (state.hand.length === 1) {
      setSelectedTileId(tileId);
      return;
    }
    if (continuationStep === "bonus") {
      setBonusTileId(tileId);
      if (selectedTileId === tileId) setSelectedTileId(null);
      setContinuationStep("attack");
    } else {
      setSelectedTileId(tileId);
      if (bonusTileId === tileId) setBonusTileId(null);
    }
  };

  const submitPrimary = () => {
    if (!selectedTileId) return;
    if (state.phase === "choose-attack") submitAction({ type: "tile/attack", payload: { tileId: selectedTileId } });
    if (state.phase === "await-defense") submitAction({ type: "tile/defend", payload: { tileId: selectedTileId } });
    if (state.phase === "continuation") {
      submitAction({ type: "tile/continue", payload: { bonusTileId: state.hand.length >= 2 ? bonusTileId : null, attackTileId: selectedTileId } });
    }
  };

  return (
    <section className={`game-module parity-tile-duel ${state.phase} ${isSubmitting ? "is-submitting" : ""} ${isBattlefieldApplying ? "is-battlefield-applying" : ""}`} data-battlefield={battlefield.id} aria-busy={isBattlefieldApplying} aria-label={`타이거 앤 드래곤 ${battlefield.name} 게임판`}>
      <div className="ptd-arena-crests" aria-hidden="true">
        <TigerCrest className="ptd-arena-tiger" />
        <DragonCrest className="ptd-arena-dragon" />
        <span className="ptd-field-landmark"><i /><i /><i /></span>
      </div>
      {showBattlefieldDialog && typeof document !== "undefined" ? createPortal(
        <div className="ptd-battlefield-portal" data-ptd-battlefield-portal data-battlefield={battlefield.id}>
          <div className={`ptd-battlefield-overlay ${battlefieldRevealComplete ? "is-revealed" : "is-drawing"} ${isBattlefieldApplying ? "is-applying" : ""}`}>
          <section
            ref={battlefieldDialogRef}
            className="ptd-battlefield-dialog"
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="ptd-battlefield-dialog-title"
            aria-describedby="ptd-battlefield-dialog-description"
          >
            <div className="ptd-battlefield-draw" aria-hidden="true">
              <span className="ptd-draw-card ptd-draw-card-left"><img src={TILE_ART.back} alt="" /></span>
              <span className="ptd-draw-card ptd-draw-card-right"><img src={TILE_ART.back} alt="" /></span>
              <span className="ptd-draw-card ptd-draw-card-chosen">
                <span className="ptd-draw-card-back"><img src={TILE_ART.back} alt="" /></span>
                <span className="ptd-draw-card-front"><b>{fieldPresentation.glyph}</b><small>{fieldPresentation.eyebrow}</small></span>
              </span>
            </div>

            <div className="ptd-battlefield-copy" aria-live="polite">
              <span className="ptd-kicker">{isBattlefieldApplying ? "전장 환경을 게임판에 적용합니다" : isBattlefieldRevealDialog ? "이번 대결의 환경을 뽑았습니다" : "현재 적용 중인 환경"}</span>
              <h2 id="ptd-battlefield-dialog-title">{battlefieldRevealComplete ? battlefield.name : "전장 선택 중"}</h2>
              {battlefieldRevealComplete ? (
                <>
                  <p id="ptd-battlefield-dialog-description">{fieldPresentation.atmosphere}</p>
                  <div className="ptd-battlefield-effect">
                    <span>환경 효과</span>
                    <strong>{battlefieldDisplay.bonusLabel}</strong>
                    <p>{battlefield.description}</p>
                  </div>
                  <ul>
                    {battlefieldDisplay.rules.map((rule) => <li key={rule}>{rule}</li>)}
                  </ul>
                </>
              ) : (
                <p id="ptd-battlefield-dialog-description">봉인된 전장 카드가 곧 공개됩니다.</p>
              )}
            </div>

            {battlefieldRevealComplete ? (
              <div className="ptd-battlefield-dialog-footer">
                {isBattlefieldRevealDialog && !isBattlefieldApplying ? (
                  <div className="ptd-battlefield-acknowledgements" role="status" aria-live="polite" aria-atomic="true" aria-label="환경 확인 현황">
                    <span>
                      {state.battlefieldAcknowledgedPlayerIds.length}/{state.playerIds.length} 확인
                      {state.battlefieldAcknowledgedPlayerIds.length === state.playerIds.length ? " · 전원 확인 완료" : " · 다른 플레이어를 기다리는 중"}
                    </span>
                    <div>
                      {state.playerIds.map((id) => (
                        <i className={state.battlefieldAcknowledgedPlayerIds.includes(id) ? "confirmed" : ""} key={id}>
                          {getPlayerName(players, id)}
                        </i>
                      ))}
                    </div>
                  </div>
                ) : null}
                {isBattlefieldApplying ? (
                  <p className="ptd-battlefield-apply-status" role="status" aria-live="assertive">환경을 게임판에 적용 중입니다</p>
                ) : isBattlefieldRevealDialog ? (
                  <button
                    ref={battlefieldDialogActionRef}
                    type="button"
                    disabled={!canAcknowledgeBattlefield || hasAcknowledgedBattlefield}
                    onClick={() => submitAction({ type: "tile/acknowledge-battlefield" })}
                  >
                    {hasAcknowledgedBattlefield ? "다른 플레이어 확인 대기 중" : myId ? "환경 이해됐습니다" : "플레이어 확인 대기 중"}
                  </button>
                ) : (
                  <button
                    ref={battlefieldDialogActionRef}
                    type="button"
                    onClick={closeBattlefieldInfo}
                  >게임으로 돌아가기</button>
                )}
              </div>
            ) : null}
            </section>
          </div>
        </div>,
        document.body
      ) : null}
      <header className="ptd-header">
        <div className="ptd-field-title">
          <button ref={battlefieldSealRef} className="ptd-field-seal" type="button" aria-label={`${battlefield.name} 환경 설명 다시 보기`} onClick={(event) => openBattlefieldInfo(event.currentTarget)}>{fieldPresentation.glyph}</button>
          <div>
            <span className="ptd-kicker">제 {state.roundNumber} 공방 · 목표 {state.targetScore}점</span>
            <h2>{battlefield.name}</h2>
            <p>{battlefield.description}</p>
            <button className="ptd-field-info-trigger" type="button" onClick={(event) => openBattlefieldInfo(event.currentTarget)}>적용 환경 읽어보기</button>
          </div>
          <span className="ptd-field-trait"><small>{fieldPresentation.eyebrow}</small><strong>{battlefieldDisplay.bonusLabel}</strong></span>
        </div>
        <div className="ptd-scoreboard" data-player-count={state.playerIds.length} aria-label="플레이어 점수">
          {state.playerIds.map((id, index) => (
            <div className={id === state.activePlayerId ? "active" : ""} key={id}>
              <span className="ptd-medallion" aria-hidden="true">{index + 1}</span>
              <span>{getPlayerName(players, id)}</span>
              <strong key={`${id}-score-${state.scores[id] ?? 0}`}>{state.scores[id] ?? 0}</strong>
              <small>패 {state.handCounts[id] ?? 0}</small>
            </div>
          ))}
        </div>
      </header>

      <DefenseGuide />

      {state.phase !== "finished" ? <div className="ptd-flow" aria-live="polite">
        <div className="ptd-flow-label">
          <span>{showRoundOutcome ? "마지막 타일" : "현재 공격"}</span>
          <strong>{showRoundOutcome && state.lastRound ? tileLabel(state.lastRound.finishTile) : state.currentAttack ? getPlayerName(players, state.attackerId) : "공격 준비"}</strong>
        </div>
        <TileFace
          key={showRoundOutcome && state.lastRound ? `finish-${state.lastRound.finishTile.id}` : state.currentAttack?.tile.id ?? "attack-ready"}
          tile={showRoundOutcome && state.lastRound ? state.lastRound.finishTile : state.currentAttack?.tile ?? null}
        />
        <span className="ptd-arrow" key={`arrow-${showRoundOutcome && state.lastRound ? state.lastRound.finishTile.id : state.currentAttack?.tile.id ?? "ready"}`} aria-hidden="true">→</span>
        <div className="ptd-flow-label responder">
          <span>{showRoundOutcome ? "공방 승자" : state.phase === "continuation" ? "연속 공격" : "응답 차례"}</span>
          <strong>{showRoundOutcome && state.lastRound ? getPlayerName(players, state.lastRound.winnerId) : getPlayerName(players, state.activePlayerId)}</strong>
        </div>
        <p key={state.message}>{state.message}</p>
      </div> : null}

      <div className="ptd-boards" aria-label="공개 타일 기록">
        {state.playerIds.map((id, index) => {
          const board = state.boards[id];
          return (
            <article className={id === state.attackerId ? "attacker" : ""} key={id}>
              <header>
                <span className="ptd-medallion" aria-hidden="true">{index + 1}</span>
                <strong>{getPlayerName(players, id)}</strong>
                {state.passedPlayerIds.includes(id) ? <em>패스</em> : null}
              </header>
              <div className="ptd-board-track">
                {board.openingAttack ? <TileFace tile={board.openingAttack.tile} compact /> : <span className="ptd-empty-slot">첫 공격</span>}
                {board.pairs.map((pair, pairIndex) => (
                  <div className="ptd-pair" key={`${id}-pair-${pairIndex}`}>
                    {pair.defense ? <TileFace tile={pair.defense.tile} hidden={pair.defense.hidden} compact /> : <span className="ptd-empty-slot">방어</span>}
                    <span aria-hidden="true">↗</span>
                    {pair.attack ? <TileFace tile={pair.attack.tile} compact /> : <span className="ptd-empty-slot">공격</span>}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {state.lastRound && !showOutcomePanel ? (
        <aside className="ptd-last-result" aria-label="직전 라운드 결과">
          <span className="ptd-medallion" aria-hidden="true">✓</span>
          <div>
            <strong>{getPlayerName(players, state.lastRound.winnerId)} · +{state.lastRound.points}점</strong>
            <small>{state.lastRound.reasons.join(" · ")}</small>
          </div>
        </aside>
      ) : null}

      {!showOutcomePanel ? <section className="ptd-rack" aria-label="내 타일 패">
        <div className="ptd-rack-heading">
          <div>
            <span className="ptd-kicker">내 작업대</span>
            <strong>{myTurn ? "타일을 선택하세요" : `${getPlayerName(players, state.activePlayerId)} 차례`}</strong>
          </div>
          {state.phase === "continuation" && state.hand.length >= 2 ? (
            <div className="ptd-step-switch" role="group" aria-label="연속 공격 선택 단계">
              <button type="button" aria-pressed={continuationStep === "bonus"} onClick={() => setContinuationStep("bonus")}>1. 보너스</button>
              <button type="button" aria-pressed={continuationStep === "attack"} onClick={() => setContinuationStep("attack")}>2. 공격</button>
            </div>
          ) : null}
        </div>
        <div className="ptd-hand">
          {state.hand.length === 0 ? <p>관전 중이거나 남은 타일이 없습니다.</p> : null}
          {state.hand.map((tile, tileIndex) => {
            const defendable = Boolean(state.currentAttack && canDefend(state.currentAttack.tile, tile));
            const selected = tile.id === selectedTileId;
            const bonus = tile.id === bonusTileId;
            return (
              <button
                type="button"
                className={`ptd-hand-tile ${selected ? "selected" : ""} ${bonus ? "bonus-selected" : ""} ${defendable ? "defendable" : ""}`}
                key={tile.id}
                disabled={controlsDisabled || state.phase === "finished"}
                aria-pressed={selected || bonus}
                aria-label={`${tileLabel(tile)}, 손패 ${tileIndex + 1}${defendable ? ", 현재 공격 방어 가능" : ""}${bonus ? ", 보너스로 선택됨" : selected ? ", 공격으로 선택됨" : ""}`}
                onClick={() => chooseTile(tile.id)}
              >
                <TileFace tile={tile} />
                {bonus ? <small>보너스</small> : selected ? <small>{state.phase === "await-defense" ? "방어" : "공격"}</small> : null}
              </button>
            );
          })}
        </div>
        <div className="ptd-actions">
          {state.phase === "await-defense" ? (
            <button type="button" className="secondary" disabled={controlsDisabled} onClick={() => submitAction({ type: "tile/pass" })}>패스</button>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={
              controlsDisabled ||
              !selectedTileId ||
              (state.phase === "await-defense" && !canUseSelectedForDefense) ||
              (state.phase === "continuation" && state.hand.length >= 2 && (!bonusTileId || bonusTileId === selectedTileId)) ||
              state.phase === "finished"
            }
            onClick={submitPrimary}
          >
            {state.phase === "await-defense" ? "선택 타일로 방어" : state.phase === "continuation" ? "보너스와 공격 확정" : "선택 타일로 공격"}
          </button>
        </div>
      </section> : (
        <section className={`ptd-outcome-panel ${state.phase}`} role="status" aria-live="polite" aria-label={state.phase === "finished" ? "최종 대결 결과" : "공방 결과"}>
          <span className="ptd-outcome-seal" aria-hidden="true">{state.phase === "finished" ? "勝" : "決"}</span>
          <div>
            <span className="ptd-kicker">{state.phase === "finished" ? "대결 종료" : `제 ${state.roundNumber} 공방 결과`}</span>
            <h3>{outcomeWinnerNames || "승자 없음"}{state.phase === "finished" ? " 승리" : " 공방 승리"}</h3>
            <p>
              {state.phase === "finished"
                ? state.roundForfeitPlayerId
                  ? "상대의 누적 시간 초과로 최종 승리했습니다."
                  : `목표 ${state.targetScore}점에 먼저 도달했습니다.`
                : state.lastRound
                  ? `마지막 ${tileLabel(state.lastRound.finishTile)} · ${state.lastRound.reasons.join(" · ")}`
                  : "다음 공방을 준비하고 있습니다."}
            </p>
          </div>
          {state.phase === "round-result" && state.lastRound ? (
            <strong className="ptd-outcome-points">+{state.lastRound.points}점</strong>
          ) : null}
        </section>
      )}
    </section>
  );
}
