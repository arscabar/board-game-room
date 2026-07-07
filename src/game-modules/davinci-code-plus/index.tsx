import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule, GameSystemAction } from "../types";
import { useInteractionGate } from "../useInteractionGate";

type TileKind = "number" | "joker";
type TileColor = "black" | "white" | "red" | "joker";
type PublicTileColor = TileColor | "hidden";
type VinciGuess = number | "joker";
type VinciPhase = "draw" | "guessing" | "decide" | "complete";

interface VinciTile {
  id: string;
  kind: TileKind;
  color: TileColor;
  value: number | null;
  revealed: boolean;
}

interface VinciPlayer {
  id: string;
  name: string;
  seat: number;
  teamId: string | null;
  hand: VinciTile[];
  bonusCards: number;
  usedBonusCards: number;
  points: number;
  eliminated: boolean;
}

interface VinciState {
  players: VinciPlayer[];
  deck: VinciTile[];
  phase: VinciPhase;
  drawnTileId: string | null;
  currentStreak: number;
  winnerId: string | null;
  winnerIds: string[];
  message: string;
  lastGuess: {
    playerId: string;
    targetPlayerId: string;
    tileIndex: number;
    guess: VinciGuess;
    correct: boolean;
  } | null;
}

interface PublicVinciTile {
  id: string;
  kind: TileKind | null;
  color: PublicTileColor;
  value: number | null;
  revealed: boolean;
  teamClue?: boolean;
}

interface PublicVinciPlayer {
  id: string;
  name: string;
  seat: number;
  teamId: string | null;
  hand: PublicVinciTile[];
  bonusCards: number;
  usedBonusCards: number;
  points: number;
  eliminated: boolean;
}

interface VinciPublicState {
  players: PublicVinciPlayer[];
  deckCount: number;
  phase: VinciPhase;
  drawnTileId: string | null;
  currentStreak: number;
  winnerId: string | null;
  winnerIds: string[];
  message: string;
  viewerId: string | null;
  lastGuess: VinciState["lastGuess"];
}

interface GuessPayload {
  targetPlayerId: string;
  tileIndex: number;
  guess: VinciGuess;
}

const colors: Exclude<TileColor, "joker">[] = ["black", "white", "red"];
const colorLabels: Record<TileColor, string> = {
  black: "파란색",
  white: "노란색",
  red: "빨간색",
  joker: "조커"
};
const colorOrder: Record<TileColor, number> = {
  red: 0,
  white: 1,
  black: 2,
  joker: 3
};
const tileValues = Array.from({ length: 12 }, (_, index) => index);
const jokerCount = 3;
const guessOptions = [...tileValues, "joker"] as const;

function isGuessPayload(value: unknown): value is GuessPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.targetPlayerId === "string" &&
    Number.isInteger(item.tileIndex) &&
    (Number.isInteger(item.guess) || item.guess === "joker")
  );
}

function createDeck() {
  const deck = colors.flatMap((color) =>
    tileValues.map((value): VinciTile => ({
      id: `${color}-${value}`,
      kind: "number",
      color,
      value,
      revealed: false
    }))
  );
  for (let index = 0; index < jokerCount; index += 1) {
    deck.push({
      id: `joker-${index + 1}`,
      kind: "joker",
      color: "joker",
      value: null,
      revealed: false
    });
  }

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

function sortHand(hand: VinciTile[]) {
  return [...hand].sort((a, b) => {
    if (a.kind === "joker" && b.kind === "joker") return a.id.localeCompare(b.id);
    if (a.kind === "joker") return 1;
    if (b.kind === "joker") return -1;
    return (a.value ?? 0) - (b.value ?? 0) || colorOrder[a.color] - colorOrder[b.color];
  });
}

function initialHandSize(playerCount: number) {
  return playerCount >= 4 ? 3 : 4;
}

function teamIdForSeat(seat: number, playerCount: number) {
  if (playerCount !== 4) {
    return null;
  }
  return seat % 2 === 1 ? "A" : "B";
}

function sameTeam(first: Pick<VinciPlayer, "teamId"> | undefined, second: Pick<VinciPlayer, "teamId"> | undefined) {
  return Boolean(first?.teamId && second?.teamId && first.teamId === second.teamId);
}

function cloneState(state: VinciState): VinciState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hand: player.hand.map((tile) => ({ ...tile }))
    })),
    deck: state.deck.map((tile) => ({ ...tile })),
    lastGuess: state.lastGuess ? { ...state.lastGuess } : null
  };
}

function refreshEliminations(state: VinciState) {
  for (const player of state.players) {
    player.eliminated = player.hand.length > 0 && player.hand.every((tile) => tile.revealed);
  }
}

function livePlayers(state: VinciState, context?: GameContext) {
  if (!context) {
    return state.players.filter((player) => !player.eliminated);
  }
  const connectedIds = new Set(context.players.filter((player) => player.connected).map((player) => player.id));
  return state.players.filter((player) => !player.eliminated && connectedIds.has(player.id));
}

function findWinnerIds(state: VinciState, context?: GameContext) {
  const live = livePlayers(state, context);
  if (live.length === 1) {
    return [live[0].id];
  }
  const liveTeamId = live[0]?.teamId;
  if (liveTeamId && live.every((player) => player.teamId === liveTeamId)) {
    return state.players.filter((player) => player.teamId === liveTeamId).map((player) => player.id);
  }
  return [];
}

function advanceTurn(state: VinciState, context: GameContext, fromPlayerId: string | null = context.activePlayerId) {
  const order = livePlayers(state, context);
  if (order.length === 0) {
    return { activePlayerId: null, turnNumber: context.turnNumber + 1, roundNumber: context.roundNumber };
  }

  const fromSeat = state.players.find((player) => player.id === fromPlayerId)?.seat ?? -1;
  const nextPlayer = order.find((player) => player.seat > fromSeat) ?? order[0];
  const wrapped = fromSeat !== -1 && nextPlayer.seat <= fromSeat;
  return {
    activePlayerId: nextPlayer.id,
    turnNumber: context.turnNumber + 1,
    roundNumber: context.roundNumber + (wrapped ? 1 : 0)
  };
}

function phaseForTurnStart(state: VinciState) {
  return state.deck.length > 0 ? "draw" : "guessing";
}

function requireActivePlayer(state: VinciState, context: GameContext) {
  if (state.winnerId || state.phase === "complete") {
    throw new Error("이미 종료된 게임입니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("다빈치 코드 플레이어를 찾을 수 없습니다.");
  }
  if (player.eliminated) {
    throw new Error("탈락한 플레이어는 행동할 수 없습니다.");
  }
  return player;
}

function completeIfWinner(state: VinciState, context: GameContext, logPrefix: string): GameActionResult | null {
  refreshEliminations(state);
  const winnerIds = findWinnerIds(state, context);
  if (winnerIds.length === 0) return null;

  const winnerId = winnerIds[0] ?? null;
  const winner = state.players.find((player) => player.id === winnerId);
  state.winnerId = winnerId;
  state.winnerIds = winnerIds;
  state.phase = "complete";
  const teamWinners = winner?.teamId ? state.players.filter((player) => player.teamId === winner.teamId) : [];
  state.message =
    teamWinners.length > 1
      ? `${winner?.teamId}팀이 마지막까지 숨은 타일을 남겼습니다.`
      : `${winner?.name ?? "플레이어"}님이 마지막까지 숨은 타일을 남겼습니다.`;
  return {
    state,
    log: `${logPrefix}; ${teamWinners.length > 1 ? `${winner?.teamId}팀` : winner?.name ?? "플레이어"} 승리`,
    activePlayerId: null,
    phase: "complete",
    message: state.message,
    winnerId
  };
}

function applySelfPenalty(player: VinciPlayer, drawnTileId: string | null) {
  const penaltyTile = player.hand.find((tile) => tile.id === drawnTileId && !tile.revealed) ?? player.hand.find((tile) => !tile.revealed);
  const protectedByBonus = player.bonusCards > 0;
  if (protectedByBonus) {
    player.bonusCards -= 1;
    player.usedBonusCards += 1;
  } else if (penaltyTile) {
    penaltyTile.revealed = true;
  }

  return { penaltyTile, protectedByBonus };
}

function applyGuess(state: VinciState, action: GameAction, context: GameContext): GameActionResult {
  if (!isGuessPayload(action.payload)) {
    throw new Error("추측할 상대, 타일 위치, 숫자가 필요합니다.");
  }

  const player = requireActivePlayer(state, context);
  if (state.phase !== "guessing") {
    throw new Error(state.phase === "draw" ? "먼저 타일을 뽑아야 합니다." : "계속 추측을 선택해야 다음 추측을 할 수 있습니다.");
  }

  const { targetPlayerId, tileIndex, guess } = action.payload;
  if (typeof guess === "number" && (guess < 0 || guess > 11)) {
    throw new Error("추측 숫자는 0부터 11까지입니다.");
  }
  if (targetPlayerId === player.id) {
    throw new Error("다른 플레이어의 타일을 골라야 합니다.");
  }

  const next = cloneState(state);
  const nextPlayer = next.players.find((candidate) => candidate.id === player.id);
  const target = next.players.find((candidate) => candidate.id === targetPlayerId);
  if (!nextPlayer || !target || target.eliminated) {
    throw new Error("선택한 상대를 추측할 수 없습니다.");
  }
  if (sameTeam(nextPlayer, target)) {
    throw new Error("팀전에서는 같은 팀원의 타일을 추측할 수 없습니다.");
  }

  const targetTile = target.hand[tileIndex];
  if (!targetTile) {
    throw new Error("선택한 타일이 없습니다.");
  }
  if (targetTile.revealed) {
    throw new Error("이미 공개된 타일입니다.");
  }

  const correct = targetTile.kind === "joker" ? guess === "joker" : targetTile.value === guess;
  next.lastGuess = {
    playerId: player.id,
    targetPlayerId,
    tileIndex,
    guess,
    correct
  };

  if (correct) {
    const wasEliminated = target.eliminated;
    targetTile.revealed = true;
    refreshEliminations(next);
    nextPlayer.points += target.eliminated && !wasEliminated ? 3 : 1;
    const logPrefix = `${player.name}님이 ${target.name}님의 ${tileIndex + 1}번 타일을 맞힘`;
    const complete = completeIfWinner(next, context, logPrefix);
    if (complete) return complete;

    next.phase = "decide";
    next.currentStreak += 1;
    next.message = `${player.name}님이 ${target.name}님의 ${colorLabels[targetTile.color]} 타일을 공개했습니다.`;
    return {
      state: next,
      log: logPrefix,
      activePlayerId: player.id,
      phase: "decide",
      message: next.message,
      winnerId: null
    };
  }

  const { penaltyTile, protectedByBonus } = applySelfPenalty(nextPlayer, next.drawnTileId);
  refreshEliminations(next);
  const logPrefix = `${player.name}님이 추측 실패`;
  const complete = completeIfWinner(next, context, logPrefix);
  if (complete) return complete;

  const turn = advanceTurn(next, context, player.id);
  next.drawnTileId = null;
  next.phase = phaseForTurnStart(next);
  next.currentStreak = 0;
  next.message = protectedByBonus
    ? `${player.name}님이 틀렸지만 보너스 카드로 자기 타일 공개를 막았습니다.`
    : penaltyTile
      ? `${player.name}님이 틀려서 자기 타일 1개를 공개했습니다.`
      : `${player.name}님이 틀렸지만 공개할 숨은 타일이 없습니다.`;
  return {
    state: next,
    log: logPrefix,
    phase: next.phase,
    message: next.message,
    winnerId: null,
    ...turn
  };
}

function drawTile(state: VinciState, context: GameContext): GameActionResult {
  const player = requireActivePlayer(state, context);
  if (state.phase !== "draw") {
    throw new Error("지금은 타일을 뽑을 단계가 아닙니다.");
  }

  const next = cloneState(state);
  const nextPlayer = next.players.find((candidate) => candidate.id === player.id);
  if (!nextPlayer) {
    throw new Error("다빈치 코드 플레이어를 찾을 수 없습니다.");
  }

  const drawnTile = next.deck.shift() ?? null;
  if (drawnTile) {
    nextPlayer.hand = sortHand([...nextPlayer.hand, drawnTile]);
    next.drawnTileId = drawnTile.id;
    next.message = `${player.name}님이 타일 1개를 뽑았습니다. 상대 타일을 추측하세요.`;
  } else {
    next.drawnTileId = null;
    next.message = "더미가 비었습니다. 바로 추측하세요.";
  }
  next.phase = "guessing";

  return {
    state: next,
    log: drawnTile ? `${player.name} 타일 드로우` : `${player.name} 빈 더미 확인`,
    activePlayerId: player.id,
    phase: next.phase,
    message: next.message,
    winnerId: null
  };
}

function continueGuessing(state: VinciState, context: GameContext): GameActionResult {
  const player = requireActivePlayer(state, context);
  if (state.phase !== "decide") {
    throw new Error("계속 추측할 수 있는 정답 상태가 아닙니다.");
  }

  const next = cloneState(state);
  next.phase = "guessing";
  next.message = `${player.name}님이 계속 추측합니다.`;
  return {
    state: next,
    log: `${player.name} 계속 추측`,
    activePlayerId: player.id,
    phase: "guessing",
    message: next.message,
    winnerId: null
  };
}

function passTurn(state: VinciState, context: GameContext): GameActionResult {
  const player = requireActivePlayer(state, context);
  if (state.phase !== "decide") {
    throw new Error("정답을 맞힌 뒤에만 턴을 끝낼 수 있습니다.");
  }

  const next = cloneState(state);
  const turn = advanceTurn(next, context, player.id);
  next.drawnTileId = null;
  next.phase = phaseForTurnStart(next);
  next.currentStreak = 0;
  next.message = `${player.name}님이 턴을 끝냈습니다.`;
  return {
    state: next,
    log: `${player.name} 턴 종료`,
    phase: next.phase,
    message: next.message,
    winnerId: null,
    ...turn
  };
}

function timeoutTurn(state: VinciState, context: GameContext): GameActionResult {
  const player = requireActivePlayer(state, context);
  const next = cloneState(state);
  const nextPlayer = next.players.find((candidate) => candidate.id === player.id);
  if (!nextPlayer) {
    throw new Error("다빈치 코드 플레이어를 찾을 수 없습니다.");
  }

  if (next.phase === "decide") {
    const turn = advanceTurn(next, context, player.id);
    next.drawnTileId = null;
    next.phase = phaseForTurnStart(next);
    next.currentStreak = 0;
    next.message = `${player.name}님이 결정 시간을 넘겨 턴을 종료했습니다.`;
    return {
      state: next,
      log: `${player.name} 제한 시간 초과로 턴 종료`,
      phase: next.phase,
      message: next.message,
      winnerId: null,
      ...turn
    };
  }

  if (next.phase === "draw") {
    const turn = advanceTurn(next, context, player.id);
    next.drawnTileId = null;
    next.currentStreak = 0;
    next.phase = phaseForTurnStart(next);
    next.message = `${player.name}님이 제한 시간 안에 타일을 뽑지 않아 턴을 넘겼습니다.`;
    return {
      state: next,
      log: `${player.name} 드로우 전 시간 초과`,
      phase: next.phase,
      message: next.message,
      winnerId: null,
      ...turn
    };
  }

  const { penaltyTile, protectedByBonus } = applySelfPenalty(nextPlayer, next.drawnTileId);
  next.lastGuess = null;
  refreshEliminations(next);
  const logPrefix = `${player.name}님 시간 초과 자동 오답`;
  const complete = completeIfWinner(next, context, logPrefix);
  if (complete) return complete;

  const turn = advanceTurn(next, context, player.id);
  next.drawnTileId = null;
  next.phase = phaseForTurnStart(next);
  next.currentStreak = 0;
  next.message = protectedByBonus
    ? `${player.name}님이 제한 시간을 넘겼지만 보너스 카드로 자기 타일 공개를 막았습니다.`
    : penaltyTile
      ? `${player.name}님이 제한 시간을 넘겨 자기 타일 1개가 공개되었습니다.`
      : `${player.name}님이 제한 시간을 넘겼지만 공개할 숨은 타일이 없습니다.`;
  return {
    state: next,
    log: `${player.name} 제한 시간 초과 자동 오답`,
    phase: next.phase,
    message: next.message,
    winnerId: null,
    ...turn
  };
}

function applySystemAction(state: VinciState, action: GameSystemAction, context: GameContext): GameActionResult {
  if (action.type === "system/pass") {
    return passTurn(state, context);
  }
  if (action.type === "system/timeout") {
    return timeoutTurn(state, context);
  }
  throw new Error("지원하지 않는 시스템 행동입니다.");
}

function createInitialState(context: Pick<GameContext, "game" | "players">): VinciState {
  const seatedPlayers = context.players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 4);
  const deck = createDeck();
  const handSize = initialHandSize(seatedPlayers.length);

  const players = seatedPlayers.map((player): VinciPlayer => {
    const hand = sortHand(deck.splice(0, handSize));
    return {
      id: player.id,
      name: player.name,
      seat: player.seat,
      teamId: teamIdForSeat(player.seat, seatedPlayers.length),
      hand,
      bonusCards: 1,
      usedBonusCards: 0,
      points: 0,
      eliminated: false
    };
  });

  return {
    players,
    deck,
    phase: deck.length > 0 ? "draw" : "guessing",
    drawnTileId: null,
    currentStreak: 0,
    winnerId: null,
    winnerIds: [],
    message: "타일 랙 준비 완료. 차례가 되면 타일을 뽑고 추측하세요.",
    lastGuess: null
  };
}

export const module: GameModule = {
  id: "davinci-code-plus",
  createInitialState,
  getPublicState: (state, context): VinciPublicState => {
    const vinciState = state as VinciState;
    const viewer = vinciState.players.find((player) => player.id === context.viewerId);
    return {
      players: vinciState.players.map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        teamId: player.teamId,
        eliminated: player.eliminated,
        hand: player.hand.map((tile, index) => {
          const firstHiddenIndex = player.hand.findIndex((candidate) => !candidate.revealed);
          const teamClue = sameTeam(player, viewer) && player.id !== context.viewerId && firstHiddenIndex === index && !tile.revealed;
          const visible = tile.revealed || player.id === context.viewerId || teamClue;
          return {
            id: visible ? tile.id : `${player.id}-hidden-${index}`,
            kind: visible ? tile.kind : null,
            color: tile.color,
            value: visible && tile.kind === "number" ? tile.value : null,
            revealed: tile.revealed,
            teamClue
          };
        }),
        bonusCards: player.bonusCards,
        usedBonusCards: player.usedBonusCards,
        points: player.points
      })),
      deckCount: vinciState.deck.length,
      phase: vinciState.phase,
      drawnTileId:
        vinciState.drawnTileId &&
        vinciState.players.some((player) => player.id === context.viewerId && player.hand.some((tile) => tile.id === vinciState.drawnTileId))
          ? vinciState.drawnTileId
          : null,
      currentStreak: vinciState.currentStreak,
      winnerId: vinciState.winnerId,
      winnerIds: [...vinciState.winnerIds],
      message: vinciState.message,
      viewerId: context.viewerId,
      lastGuess: vinciState.lastGuess ? { ...vinciState.lastGuess } : null
    };
  },
  applyAction: (state, action, context) => {
    const vinciState = state as VinciState;
    if (action.type === "draw") {
      return drawTile(vinciState, context);
    }
    if (action.type === "guess") {
      return applyGuess(vinciState, action, context);
    }
    if (action.type === "continue") {
      return continueGuessing(vinciState, context);
    }
    if (action.type === "pass") {
      return passTurn(vinciState, context);
    }
    throw new Error("지원하지 않는 다빈치 코드 행동입니다.");
  },
  applySystemAction: (state, action, context) => applySystemAction(state as VinciState, action, context)
};

function tileText(tile: PublicVinciTile, ownerId: string, viewerId: string | null) {
  if (tile.kind === "joker" && (tile.revealed || ownerId === viewerId)) return "★";
  if (tile.value !== null) return String(tile.value);
  if (ownerId === viewerId) return "?";
  return "?";
}

function hiddenTileIndices(player: PublicVinciPlayer | undefined) {
  if (!player || player.eliminated) return [];
  return player.hand.map((tile, index) => ({ tile, index })).filter(({ tile }) => !tile.revealed).map(({ index }) => index);
}

function guessLabel(guess: VinciGuess) {
  return guess === "joker" ? "조커" : String(guess);
}

function colorStyle(color: PublicTileColor): CSSProperties {
  if (color === "hidden") return { "--tile-bg": "#3d4652", "--tile-fg": "#ffffff" } as CSSProperties;
  if (color === "joker") return { "--tile-bg": "#3b2a4d", "--tile-fg": "#ffffff" } as CSSProperties;
  if (color === "black") return { "--tile-bg": "#175fbd", "--tile-fg": "#ffffff" } as CSSProperties;
  if (color === "red") return { "--tile-bg": "#c8232f", "--tile-fg": "#ffffff" } as CSSProperties;
  return { "--tile-bg": "#f0c83b", "--tile-fg": "#2a2214" } as CSSProperties;
}

export function Component(props: GameComponentProps) {
  const { activePlayer, currentPlayer, disabled, onAction } = props;
  const publicState = props.publicState as VinciPublicState;
  const [targetPlayerId, setTargetPlayerId] = useState("");
  const [tileIndex, setTileIndex] = useState(0);
  const [guess, setGuess] = useState<VinciGuess>(0);
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const targets = useMemo(
    () =>
      publicState.players.filter(
        (player) =>
          player.id !== currentPlayer?.id &&
          !player.eliminated &&
          !(currentModulePlayer?.teamId && player.teamId === currentModulePlayer.teamId)
      ),
    [currentModulePlayer?.teamId, currentPlayer?.id, publicState.players]
  );
  const effectiveTargetId = targets.some((player) => player.id === targetPlayerId)
    ? targetPlayerId
    : targets[0]?.id ?? "";
  const target = publicState.players.find((player) => player.id === effectiveTargetId);
  const targetHiddenIndices = hiddenTileIndices(target);
  const effectiveTileIndex = targetHiddenIndices.includes(tileIndex) ? tileIndex : targetHiddenIndices[0] ?? 0;
  const winners = publicState.players.filter((player) => publicState.winnerIds.includes(player.id));
  const winnerLabel = winners.length > 0 ? winners.map((player) => player.name).join(", ") : "완료";
  const canAct =
    !disabled &&
    publicState.winnerIds.length === 0 &&
    currentModulePlayer?.id === activeModulePlayer?.id &&
    publicState.phase !== "complete";
  const canDraw = canAct && publicState.phase === "draw";
  const canGuess =
    canAct &&
    publicState.phase === "guessing" &&
    Boolean(effectiveTargetId) &&
    targetHiddenIndices.includes(effectiveTileIndex);
  const canDecide = canAct && publicState.phase === "decide";
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [activePlayer?.id, publicState.phase, publicState.drawnTileId, publicState.message, publicState.winnerIds.length],
    { cooldownMs: 620 }
  );

  function sendGuess() {
    if (!canGuess || isSubmitting) return;
    submitAction({
      type: "guess",
      payload: {
        targetPlayerId: effectiveTargetId,
        tileIndex: effectiveTileIndex,
        guess
      }
    });
  }

  return (
    <div className={`dvc-shell ${isSubmitting ? "is-submitting" : ""}`}>
      <style>{davinciStyles}</style>
      <div className="dvc-status" aria-live="polite">
        <div>
          <strong>{publicState.winnerIds.length > 0 ? "승자" : "차례"}</strong>
          <span>{publicState.winnerIds.length > 0 ? winnerLabel : activeModulePlayer?.name ?? "대기"}</span>
        </div>
      </div>

      <div className="dvc-layout">
        <div className="dvc-racks" aria-label="플레이어 타일 랙">
          {publicState.players.map((player) => {
            const isViewer = player.id === currentPlayer?.id;
            const isActive = player.id === activePlayer?.id;
            return (
              <section className={`dvc-player ${player.eliminated ? "eliminated" : ""}`} key={player.id}>
                <div className="dvc-player-head">
                  <div>
                    <strong>{player.name}</strong>
                    <span>
                      {isViewer ? "나" : isActive ? "현재 차례" : `${player.seat}번 좌석`}
                      {player.teamId ? ` · ${player.teamId}팀` : ""}
                    </span>
                  </div>
                  <span className={player.eliminated ? "dvc-badge out" : "dvc-badge"}>
                    {player.eliminated ? "탈락" : player.teamId ? `${player.teamId}팀` : isViewer ? "나" : `${player.seat}번`}
                  </span>
                </div>
                <div className="dvc-hand">
                  {player.hand.map((tile, index) => {
                    const selectable =
                      canGuess && player.id === effectiveTargetId && !tile.revealed && player.id !== currentPlayer?.id;
                    return (
                      <button
                        className={`dvc-tile ${tile.revealed ? "revealed" : ""} ${isViewer && tile.id === publicState.drawnTileId ? "drawn" : ""} ${isViewer && !tile.revealed ? "private" : ""} ${tile.teamClue ? "team-clue" : ""} ${selectable && index === effectiveTileIndex ? "selected" : ""}`}
                        disabled={!selectable}
                        key={tile.id}
                        onClick={() => {
                          setTargetPlayerId(player.id);
                          setTileIndex(index);
                        }}
                        style={colorStyle(tile.color)}
                        title={`${tile.color === "hidden" ? "숨은" : colorLabels[tile.color]} ${index + 1}번 타일`}
                        type="button"
                      >
                        <span>{tileText(tile, player.id, publicState.viewerId)}</span>
                        <small>{index + 1}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="dvc-panel" aria-label="추측 조작">
          <button className="dvc-action" disabled={!canDraw || isSubmitting} onClick={() => submitAction({ type: "draw" })} type="button">
            타일 뽑기
          </button>

          <div className="dvc-guess-card">
            <div className="dvc-guess-head">
              <strong>추측</strong>
              <span>
                {target ? `${target.name} ${effectiveTileIndex + 1}번` : "대상 없음"}
              </span>
            </div>

            <div className="dvc-guess-controls">
              <label htmlFor="dvc-target">
                상대
                <select
                  disabled={!canGuess || isSubmitting || targets.length === 0}
                  id="dvc-target"
                  onChange={(event) => {
                    setTargetPlayerId(event.currentTarget.value);
                    setTileIndex(0);
                  }}
                  value={effectiveTargetId}
                >
                  {targets.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="dvc-tile">
                타일
                <select
                  disabled={!canGuess || isSubmitting || targetHiddenIndices.length === 0}
                  id="dvc-tile"
                  onChange={(event) => setTileIndex(Number(event.currentTarget.value))}
                  value={effectiveTileIndex}
                >
                  {targetHiddenIndices.map((index) => (
                    <option key={index} value={index}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="dvc-guess">
                값
                <select
                  disabled={!canGuess || isSubmitting}
                  id="dvc-guess"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setGuess(value === "joker" ? "joker" : Number(value));
                  }}
                  value={String(guess)}
                >
                  {guessOptions.map((value) => (
                    <option key={value} value={value}>
                      {guessLabel(value)}
                    </option>
                  ))}
                </select>
              </label>

              <button className="dvc-action dvc-guess-submit" disabled={!canGuess || isSubmitting} onClick={sendGuess} type="button">
                제출
              </button>
            </div>
          </div>

          <div className="dvc-decision">
            <button disabled={!canDecide || isSubmitting} onClick={() => submitAction({ type: "continue" })} type="button">
              계속
            </button>
            <button disabled={!canDecide || isSubmitting} onClick={() => submitAction({ type: "pass" })} type="button">
              턴 종료
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

const davinciStyles = `
.dvc-shell {
  display: grid;
  gap: 14px;
  color: #17201d;
}
.dvc-status {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  padding: 12px;
  background:
    linear-gradient(180deg, #fff9ef, #ead9c1);
}
.dvc-status strong,
.dvc-status span {
  display: block;
}
.dvc-status span,
.dvc-player-head span {
  color: #52625d;
}
.dvc-badge {
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  padding: 6px 8px;
  background: #f6e6cd;
  color: #52625d;
  font-size: 0.8rem;
  font-weight: 800;
}
.dvc-badge.out {
  color: #8f2c25;
  background: #faedea;
}
.dvc-layout {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 230px;
  gap: 16px;
  align-items: start;
}
.dvc-racks {
  display: grid;
  gap: 10px;
}
.dvc-player {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  padding: 11px;
  background:
    linear-gradient(180deg, rgba(255, 250, 240, 0.95), rgba(229, 206, 174, 0.82));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
.dvc-player.eliminated {
  opacity: 0.62;
}
.dvc-player-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.dvc-player-head strong,
.dvc-player-head span {
  display: block;
}
.dvc-player-head span {
  color: #52625d;
  font-size: 0.84rem;
}
.dvc-hand {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  align-items: end;
  border: 1px solid rgba(69, 40, 31, 0.18);
  border-radius: 8px;
  padding: 9px 9px 7px;
  background:
    linear-gradient(180deg, transparent 0 calc(100% - 9px), rgba(69, 40, 31, 0.42) calc(100% - 9px)),
    rgba(255, 255, 255, 0.45);
}
.dvc-tile {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  place-items: center;
  width: 48px;
  height: 68px;
  border: 2px solid rgba(23, 32, 29, 0.28);
  border-radius: 6px;
  padding: 5px;
  background:
    radial-gradient(circle at 28% 18%, rgba(255, 255, 255, 0.26), transparent 23%),
    var(--tile-bg);
  color: var(--tile-fg);
  box-shadow:
    inset 0 -6px 9px rgba(0, 0, 0, 0.16),
    0 5px 7px rgba(52, 31, 22, 0.22);
}
.dvc-tile span {
  font-size: 1.35rem;
  font-weight: 900;
  line-height: 1;
}
.dvc-tile small {
  opacity: 0.72;
  font-size: 0.7rem;
}
.dvc-tile.private {
  box-shadow:
    inset 0 0 0 2px #d69b2d,
    inset 0 -6px 9px rgba(0, 0, 0, 0.16),
    0 5px 7px rgba(52, 31, 22, 0.22);
}
.dvc-tile.drawn {
  outline: 3px solid #d69b2d;
  outline-offset: 2px;
}
.dvc-tile.team-clue {
  outline: 3px dashed #28777c;
  outline-offset: 2px;
}
.dvc-tile.team-clue small::after {
  content: " team";
  color: #e7fff8;
  font-weight: 900;
}
.dvc-tile.drawn small::after {
  content: " new";
  color: #ffe08a;
  font-weight: 900;
}
.dvc-tile.revealed {
  transform: translateY(-2px);
  box-shadow:
    inset 0 -6px 9px rgba(0, 0, 0, 0.16),
    0 8px 14px rgba(23, 32, 29, 0.18);
}
.dvc-tile.selected {
  outline: 3px solid #28777c;
  outline-offset: 2px;
}
.dvc-panel {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  padding: 10px;
  background: linear-gradient(180deg, #fffaf0, #ead9c1);
}
.dvc-panel select {
  width: 100%;
  min-height: 44px;
  border: 1px solid rgba(23, 32, 29, 0.22);
  border-radius: 8px;
  padding: 0 10px;
  background: white;
  color: #17201d;
  font: inherit;
}
.dvc-action,
.dvc-decision button {
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  background: linear-gradient(180deg, #fff5df, #dcb878);
  color: #17201d;
  font-weight: 800;
}
.dvc-action {
  margin-top: 4px;
  background: linear-gradient(180deg, #773c36, #2c2022);
  color: white;
}
.dvc-decision {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}
@media (max-width: 780px) {
  .dvc-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 440px) {
  .dvc-player-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .dvc-tile {
    width: 44px;
    height: 64px;
  }
}
`;
