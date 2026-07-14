import { useEffect, useMemo, useRef, useState } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule, GameSystemAction } from "../types";
import { useInteractionGate } from "../useInteractionGate";

export const BLIND_CARD_DUEL = {
  startingStack: 30,
  ante: 1,
  actionTimeMs: 30_000,
  timeBankMs: 30_000,
  showdownTimeMs: 2_500,
  foldResultTimeMs: 1_500
} as const;

export type BlindRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type BlindCardPhase = "betting" | "showdown" | "settlement" | "complete";

export interface BlindCard {
  id: string;
  rank: BlindRank;
}

export interface BlindCardPlayer {
  id: string;
  name: string;
  seat: number;
}

export interface BlindCardState {
  players: [BlindCardPlayer, BlindCardPlayer];
  phase: BlindCardPhase;
  deck: BlindCard[];
  discard: BlindCard[];
  hands: Record<string, BlindCard | null>;
  stacks: Record<string, number>;
  contributions: Record<string, number>;
  pot: number;
  carriedFromTie: boolean;
  openerId: string;
  activePlayerId: string | null;
  currentBetTo: number;
  lastAggressorId: string | null;
  handNumber: number;
  shoeNumber: number;
  rngState: number;
  cardsRevealed: boolean;
  timeoutStreaks: Record<string, number>;
  timeBankMs: Record<string, number>;
  timeBankActiveForId: string | null;
  winnerId: string | null;
  winnerIds: string[];
  message: string;
}

export interface BlindCardPublicPlayer {
  id: string;
  name: string;
  seat: number;
  stack: number;
  contribution: number;
  timeBankSeconds: number;
  visibleCardRank: BlindRank | null;
  cardPresent: boolean;
}

export interface BlindCardPublicState {
  phase: BlindCardPhase;
  viewerId: string | null;
  players: BlindCardPublicPlayer[];
  pot: number;
  carriedFromTie: boolean;
  openerId: string;
  actorId: string | null;
  currentBetTo: number;
  handNumber: number;
  deckCount: number;
  discardCount: number;
  cardsRevealed: boolean;
  callAmount: number;
  minRaiseTo: number | null;
  maxBetTo: number | null;
  legalActions: Array<"open" | "raise-to" | "call" | "fold">;
  winnerId: string | null;
  winnerIds: string[];
  message: string;
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}

function nextRandom(state: number) {
  let value = state >>> 0 || 0x9e3779b9;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function makeDeck(rngState: number, shoeNumber: number) {
  const deck: BlindCard[] = [];
  for (let copy = 1; copy <= 2; copy += 1) {
    for (let rank = 1; rank <= 10; rank += 1) {
      deck.push({ id: `shoe-${shoeNumber}-${rank}-${copy}`, rank: rank as BlindRank });
    }
  }

  let random = rngState;
  for (let index = deck.length - 1; index > 0; index -= 1) {
    random = nextRandom(random);
    const swapIndex = random % (index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return { deck, rngState: random };
}

function cloneState(state: BlindCardState): BlindCardState {
  return {
    ...state,
    players: [{ ...state.players[0] }, { ...state.players[1] }],
    deck: state.deck.map((card) => ({ ...card })),
    discard: state.discard.map((card) => ({ ...card })),
    hands: Object.fromEntries(Object.entries(state.hands).map(([id, card]) => [id, card ? { ...card } : null])),
    stacks: { ...state.stacks },
    contributions: { ...state.contributions },
    timeoutStreaks: { ...state.timeoutStreaks },
    timeBankMs: { ...state.timeBankMs },
    winnerIds: [...state.winnerIds]
  };
}

function otherPlayerId(state: BlindCardState, playerId: string) {
  return state.players[0].id === playerId ? state.players[1].id : state.players[0].id;
}

function playerName(state: BlindCardState, playerId: string) {
  return state.players.find((player) => player.id === playerId)?.name ?? "플레이어";
}

function totalAvailable(state: BlindCardState, playerId: string) {
  return (state.contributions[playerId] ?? 0) + (state.stacks[playerId] ?? 0);
}

export function maximumBetTo(state: BlindCardState, playerId: string) {
  const opponentId = otherPlayerId(state, playerId);
  return Math.min(totalAvailable(state, playerId), totalAvailable(state, opponentId));
}

function putChipsTo(state: BlindCardState, playerId: string, target: number) {
  const contribution = state.contributions[playerId] ?? 0;
  const delta = target - contribution;
  if (!Number.isSafeInteger(target) || delta < 0 || delta > (state.stacks[playerId] ?? 0)) {
    throw new Error("베팅할 칩 수가 올바르지 않습니다.");
  }
  state.stacks[playerId] -= delta;
  state.contributions[playerId] = target;
  state.pot += delta;
}

function discardHands(state: BlindCardState) {
  for (const player of state.players) {
    const card = state.hands[player.id];
    if (card) state.discard.push(card);
    state.hands[player.id] = null;
    state.contributions[player.id] = 0;
  }
}

function completeMatch(state: BlindCardState, winnerIds: string[], message: string) {
  state.phase = "complete";
  state.activePlayerId = null;
  state.winnerIds = winnerIds;
  state.winnerId = winnerIds[0] ?? null;
  state.message = message;
}

function settleAnteFailure(state: BlindCardState) {
  const cannotAnteBeforeRefund = state.players.some((player) => state.stacks[player.id] < BLIND_CARD_DUEL.ante);
  if (cannotAnteBeforeRefund && state.carriedFromTie && state.pot > 0) {
    const share = Math.floor(state.pot / 2);
    state.stacks[state.players[0].id] += share;
    state.stacks[state.players[1].id] += share;
    state.pot -= share * 2;
    state.carriedFromTie = false;
  }

  const able = state.players.filter((player) => state.stacks[player.id] >= BLIND_CARD_DUEL.ante);
  if (able.length === 2) return false;
  if (able.length === 1) {
    completeMatch(state, [able[0].id], `${able[0].name}님이 마지막 앤티를 지킬 칩을 남겨 승리했습니다.`);
  } else {
    const high = Math.max(...state.players.map((player) => state.stacks[player.id]));
    const winners = state.players.filter((player) => state.stacks[player.id] === high).map((player) => player.id);
    completeMatch(state, winners, winners.length === 2 ? "두 플레이어가 같은 칩으로 대결을 마쳤습니다." : `${playerName(state, winners[0])}님이 승리했습니다.`);
  }
  return true;
}

function prepareHand(state: BlindCardState) {
  if (settleAnteFailure(state)) return;
  if (state.deck.length < 2) {
    state.shoeNumber += 1;
    const fresh = makeDeck(state.rngState, state.shoeNumber);
    state.deck = fresh.deck;
    state.discard = [];
    state.rngState = fresh.rngState;
  }

  state.cardsRevealed = false;
  state.phase = "betting";
  state.currentBetTo = BLIND_CARD_DUEL.ante;
  state.lastAggressorId = null;
  state.timeBankActiveForId = null;
  state.winnerId = null;
  state.winnerIds = [];
  for (const player of state.players) {
    state.stacks[player.id] -= BLIND_CARD_DUEL.ante;
    state.contributions[player.id] = BLIND_CARD_DUEL.ante;
    state.pot += BLIND_CARD_DUEL.ante;
    state.hands[player.id] = state.deck.shift() ?? null;
  }

  // If either player used their final chip for the ante, neither side can make
  // an additional matched wager. Resolve the dealt cards instead of presenting
  // a betting turn whose only nominal action would be an incorrect fold.
  if (state.players.some((player) => maximumBetTo(state, player.id) === state.currentBetTo)) {
    finishShowdown(state);
    return;
  }

  state.activePlayerId = state.openerId;
  state.message = `${playerName(state, state.openerId)}님부터 상대의 카드를 보고 베팅합니다.`;
}

function beginNextHand(state: BlindCardState) {
  discardHands(state);
  state.handNumber += 1;
  state.openerId = otherPlayerId(state, state.openerId);
  prepareHand(state);
}

function finishShowdown(state: BlindCardState) {
  const first = state.players[0];
  const second = state.players[1];
  const firstCard = state.hands[first.id];
  const secondCard = state.hands[second.id];
  if (!firstCard || !secondCard) throw new Error("쇼다운 카드가 없습니다.");

  state.phase = "showdown";
  state.cardsRevealed = true;
  state.activePlayerId = null;
  if (firstCard.rank === secondCard.rank) {
    state.carriedFromTie = true;
    state.message = `${firstCard.rank} 대 ${secondCard.rank}, 동률입니다. 팟은 다음 손으로 이월됩니다.`;
    return;
  }

  const winner = firstCard.rank > secondCard.rank ? first : second;
  const loser = winner.id === first.id ? second : first;
  const won = state.pot;
  state.stacks[winner.id] += won;
  state.pot = 0;
  state.carriedFromTie = false;
  state.message = `${firstCard.rank} 대 ${secondCard.rank}. ${winner.name}님이 ${won}칩 팟을 가져갑니다.`;
  if (state.stacks[loser.id] < BLIND_CARD_DUEL.ante) {
    completeMatch(state, [winner.id], `${winner.name}님이 쇼다운에서 승리해 대결을 끝냈습니다.`);
    state.cardsRevealed = true;
  }
}

function foldHand(state: BlindCardState, folderId: string, timeout = false) {
  const winnerId = otherPlayerId(state, folderId);
  const won = state.pot;
  state.stacks[winnerId] += won;
  state.pot = 0;
  state.carriedFromTie = false;
  state.phase = "settlement";
  state.activePlayerId = null;
  state.cardsRevealed = false;

  const foldedCard = state.hands[folderId];
  const penalty = foldedCard?.rank === 10 ? Math.min(10, state.stacks[folderId]) : 0;
  if (penalty > 0) {
    state.stacks[folderId] -= penalty;
    state.stacks[winnerId] += penalty;
  }
  const reason = timeout ? "시간 초과로 폴드" : "폴드";
  state.message = penalty > 0
    ? `${playerName(state, folderId)}님이 ${reason}했습니다. 숨은 10 벌칙 ${penalty}칩이 적용됩니다.`
    : `${playerName(state, folderId)}님이 ${reason}했습니다. ${playerName(state, winnerId)}님이 ${won}칩 팟을 가져갑니다.`;
  if (state.stacks[folderId] < BLIND_CARD_DUEL.ante) {
    completeMatch(state, [winnerId], `${playerName(state, winnerId)}님이 상대의 앤티를 소진시켜 승리했습니다.`);
    state.cardsRevealed = false;
  }
}

function resultFor(state: BlindCardState, context: GameContext, log: string): GameActionResult {
  return {
    state,
    log,
    activePlayerId: state.activePlayerId,
    interactivePlayerIds: state.activePlayerId ? [state.activePlayerId] : [],
    turnNumber: context.turnNumber + 1,
    roundNumber: state.handNumber,
    phase: state.phase,
    message: state.message,
    winnerId: state.winnerId,
    winnerIds: state.winnerIds,
    resetTimer: state.phase !== "complete"
  };
}

function normalizedActionType(type: string) {
  const value = type.startsWith("blind/") ? type.slice("blind/".length) : type;
  if (value === "raise") return "raise-to";
  return value;
}

function readTarget(action: GameAction) {
  if (!action.payload || typeof action.payload !== "object") return null;
  const payload = action.payload as Record<string, unknown>;
  const value = payload.to ?? payload.amount;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function requireActor(state: BlindCardState, context: GameContext) {
  if (state.phase !== "betting" || state.winnerId) throw new Error("지금은 베팅할 수 없습니다.");
  if (context.currentPlayerId !== state.activePlayerId) throw new Error("현재 행동 차례가 아닙니다.");
  if (!state.players.some((player) => player.id === context.currentPlayerId)) throw new Error("참가자만 행동할 수 있습니다.");
  return context.currentPlayerId;
}

function applyPlayerAction(state: BlindCardState, action: GameAction, context: GameContext): GameActionResult {
  const actorId = requireActor(state, context);
  const opponentId = otherPlayerId(state, actorId);
  const next = cloneState(state);
  const type = normalizedActionType(action.type);
  const actorContribution = next.contributions[actorId] ?? 0;
  const callAmount = next.currentBetTo - actorContribution;
  next.timeoutStreaks[actorId] = 0;
  next.timeBankActiveForId = null;

  if (type === "open" || type === "raise-to") {
    const target = readTarget(action);
    if (target === null) throw new Error("목표 베팅 총액을 정수로 입력해주세요.");
    if (callAmount > 0 && type === "open") throw new Error("상대 베팅에는 콜, 레이즈 또는 폴드로 응답하세요.");
    if (target < next.currentBetTo + 1) throw new Error(`최소 ${next.currentBetTo + 1}칩까지 베팅해야 합니다.`);
    const cap = maximumBetTo(next, actorId);
    if (target > cap) throw new Error(`상대가 맞출 수 있는 최대 총액은 ${cap}칩입니다.`);
    putChipsTo(next, actorId, target);
    next.currentBetTo = target;
    next.lastAggressorId = actorId;
    next.activePlayerId = opponentId;
    next.message = `${playerName(next, actorId)}님이 총 ${target}칩까지 베팅했습니다.`;
    return resultFor(next, context, `총 ${target}칩 베팅`);
  }

  if (type === "call") {
    if (callAmount <= 0) throw new Error("콜할 상대 베팅이 없습니다.");
    if (callAmount > (next.stacks[actorId] ?? 0)) throw new Error("콜할 칩이 부족합니다.");
    putChipsTo(next, actorId, next.currentBetTo);
    finishShowdown(next);
    return resultFor(next, context, "콜, 쇼다운");
  }

  if (type === "fold") {
    foldHand(next, actorId);
    return resultFor(next, context, "폴드");
  }

  throw new Error("지원하지 않는 인디언 포커 행동입니다.");
}

function applySystemAction(state: BlindCardState, action: GameSystemAction, context: GameContext): GameActionResult {
  const next = cloneState(state);
  if (next.phase === "complete") return resultFor(next, context, "종료된 대결");
  if (next.phase === "showdown" || next.phase === "settlement") {
    beginNextHand(next);
    return resultFor(next, context, `${next.handNumber}번째 손 준비`);
  }
  if (next.phase !== "betting" || !next.activePlayerId) return resultFor(next, context, "진행 대기");

  const actorId = next.activePlayerId;
  if (action.type === "system/pass") throw new Error("인디언 포커는 오픈, 콜, 레이즈 또는 폴드로만 진행합니다.");

  if ((next.timeBankMs[actorId] ?? 0) > 0 && next.timeBankActiveForId !== actorId) {
    next.timeBankMs[actorId] = 0;
    next.timeBankActiveForId = actorId;
    next.message = `${playerName(next, actorId)}님의 타임뱅크 30초가 시작되었습니다.`;
    return resultFor(next, context, `${playerName(next, actorId)} 타임뱅크 사용`);
  }

  next.timeBankActiveForId = null;

  const previousTimeouts = next.timeoutStreaks[actorId] ?? 0;
  next.timeoutStreaks[actorId] = previousTimeouts + 1;
  if (previousTimeouts >= 1) {
    const winnerId = otherPlayerId(next, actorId);
    next.cardsRevealed = false;
    completeMatch(next, [winnerId], `${playerName(next, actorId)}님의 연속 시간 초과로 ${playerName(next, winnerId)}님이 승리했습니다.`);
    return resultFor(next, context, `${playerName(next, actorId)} 연속 시간 초과 몰수패`);
  }
  foldHand(next, actorId, true);
  next.timeoutStreaks[actorId] = 1;
  return resultFor(next, context, `${playerName(next, actorId)} 시간 초과 자동 폴드`);
}

export function createBlindCardState(context: Pick<GameContext, "game" | "players" | "rngSeed" | "now">): BlindCardState {
  const seated = context.players.filter((player) => player.connected).sort((a, b) => a.seat - b.seat);
  if (seated.length !== 2) throw new Error("인디언 포커는 정확히 2명이 필요합니다.");
  const players: [BlindCardPlayer, BlindCardPlayer] = [
    { id: seated[0].id, name: seated[0].name, seat: seated[0].seat },
    { id: seated[1].id, name: seated[1].name, seat: seated[1].seat }
  ];
  const initialRandom = hashSeed(context.rngSeed ?? `${context.game.id}:${context.now ?? 0}:${players.map((player) => player.id).join(":")}`);
  const firstShoe = makeDeck(initialRandom, 1);
  const openerId = players[firstShoe.rngState % 2].id;
  const state: BlindCardState = {
    players,
    phase: "betting",
    deck: firstShoe.deck,
    discard: [],
    hands: { [players[0].id]: null, [players[1].id]: null },
    stacks: { [players[0].id]: BLIND_CARD_DUEL.startingStack, [players[1].id]: BLIND_CARD_DUEL.startingStack },
    contributions: { [players[0].id]: 0, [players[1].id]: 0 },
    pot: 0,
    carriedFromTie: false,
    openerId,
    activePlayerId: openerId,
    currentBetTo: 0,
    lastAggressorId: null,
    handNumber: 1,
    shoeNumber: 1,
    rngState: firstShoe.rngState,
    cardsRevealed: false,
    timeoutStreaks: { [players[0].id]: 0, [players[1].id]: 0 },
    timeBankMs: { [players[0].id]: BLIND_CARD_DUEL.timeBankMs, [players[1].id]: BLIND_CARD_DUEL.timeBankMs },
    timeBankActiveForId: null,
    winnerId: null,
    winnerIds: [],
    message: "카드를 준비하고 있습니다."
  };
  prepareHand(state);
  return state;
}

export function projectBlindCardState(state: BlindCardState, viewerId: string | null): BlindCardPublicState {
  const viewerIsPlayer = state.players.some((player) => player.id === viewerId);
  const actorId = state.activePlayerId;
  const actorContribution = actorId ? state.contributions[actorId] ?? 0 : 0;
  const callAmount = actorId ? Math.max(0, state.currentBetTo - actorContribution) : 0;
  const maxBetTo = actorId ? maximumBetTo(state, actorId) : null;
  const canIncrease = maxBetTo !== null && maxBetTo >= state.currentBetTo + 1;
  const legalActions: BlindCardPublicState["legalActions"] = [];
  if (state.phase === "betting" && actorId) {
    if (canIncrease) legalActions.push(state.lastAggressorId === null && callAmount === 0 ? "open" : "raise-to");
    if (callAmount > 0) legalActions.push("call");
    legalActions.push("fold");
  }

  return {
    phase: state.phase,
    viewerId,
    players: state.players.map((player) => {
      const card = state.hands[player.id];
      const maySee = state.cardsRevealed || (viewerIsPlayer && viewerId !== player.id);
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        stack: state.stacks[player.id] ?? 0,
        contribution: state.contributions[player.id] ?? 0,
        timeBankSeconds: Math.ceil((state.timeBankMs[player.id] ?? 0) / 1_000),
        visibleCardRank: card && maySee ? card.rank : null,
        cardPresent: Boolean(card)
      };
    }),
    pot: state.pot,
    carriedFromTie: state.carriedFromTie,
    openerId: state.openerId,
    actorId,
    currentBetTo: state.currentBetTo,
    handNumber: state.handNumber,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    cardsRevealed: state.cardsRevealed,
    callAmount,
    minRaiseTo: canIncrease ? state.currentBetTo + 1 : null,
    maxBetTo,
    legalActions,
    winnerId: state.winnerId,
    winnerIds: [...state.winnerIds],
    message: state.message
  };
}

export const module: GameModule = {
  id: "blind-card-duel",
  concurrencyMode: "strict",
  // Betting uses the active player; showdown/settlement use the same server clock
  // without an active player so the next hand cannot stall when all clients are idle.
  timerMode: "phase",
  getTimerDurationMs: (state) => {
    const phase = (state as BlindCardState).phase;
    if (phase === "betting") {
      const blindState = state as BlindCardState;
      return blindState.timeBankActiveForId === blindState.activePlayerId
        ? BLIND_CARD_DUEL.timeBankMs
        : BLIND_CARD_DUEL.actionTimeMs;
    }
    if (phase === "showdown") return BLIND_CARD_DUEL.showdownTimeMs;
    if (phase === "settlement") return BLIND_CARD_DUEL.foldResultTimeMs;
    return null;
  },
  createInitialState: createBlindCardState,
  getPublicState: (state, context) => projectBlindCardState(state as BlindCardState, context.viewerId),
  applyAction: (state, action, context) => applyPlayerAction(state as BlindCardState, action, context),
  applySystemAction: (state, action, context) => applySystemAction(state as BlindCardState, action, context)
};

function chipLabel(value: number) {
  return `${value}칩`;
}

function CardArtwork({ rank, hiddenMark }: { rank: number | null | undefined; hiddenMark: "✦" | "?" }) {
  if (typeof rank !== "number") {
    return <span className="bcd-card-back-mark" aria-hidden="true">{hiddenMark}</span>;
  }

  return (
    <>
      <span className="bcd-card-corner is-top" aria-hidden="true"><b>{rank}</b><i>✦</i></span>
      <strong className="bcd-card-rank" aria-hidden="true">{rank}</strong>
      <span className="bcd-card-pip" aria-hidden="true">✦</span>
      <span className="bcd-card-corner is-bottom" aria-hidden="true"><b>{rank}</b><i>✦</i></span>
    </>
  );
}

export function Component({ currentPlayer, publicState, disabled, onAction }: GameComponentProps<BlindCardPublicState>) {
  const state = publicState;
  const me = state.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const isSpectating = me === null;
  const opponent = me ? state.players.find((player) => player.id !== me.id) ?? null : state.players[0] ?? null;
  const selfSeat = me ?? state.players[1] ?? null;
  const opponentLabel = isSpectating ? "플레이어 1" : "상대";
  const selfLabel = isSpectating ? "플레이어 2" : "나";
  const actor = state.players.find((player) => player.id === state.actorId) ?? null;
  const canAct = Boolean(me && state.actorId === me.id && state.phase === "betting" && !disabled);
  const minRaise = state.minRaiseTo ?? 0;
  const maxRaise = state.maxBetTo ?? 0;
  const [raiseTo, setRaiseTo] = useState(minRaise);
  const [confirmFold, setConfirmFold] = useState(false);
  const foldButtonRef = useRef<HTMLButtonElement>(null);
  const confirmFoldButtonRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const restoreFoldFocusRef = useRef(false);
  const focusFoldResultRef = useRef(false);
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [state.phase, state.actorId, state.currentBetTo, state.handNumber, state.message],
    { cooldownMs: 550 }
  );

  useEffect(() => {
    setRaiseTo(minRaise);
    setConfirmFold(false);
  }, [minRaise, state.actorId, state.handNumber]);

  useEffect(() => {
    if (confirmFold) {
      confirmFoldButtonRef.current?.focus();
      return;
    }
    if (restoreFoldFocusRef.current) {
      restoreFoldFocusRef.current = false;
      foldButtonRef.current?.focus();
    }
  }, [confirmFold]);

  useEffect(() => {
    if (!focusFoldResultRef.current || state.phase === "betting") return;
    focusFoldResultRef.current = false;
    messageRef.current?.focus({ preventScroll: true });
  }, [state.phase]);

  const legal = useMemo(() => new Set(state.legalActions), [state.legalActions]);
  const controlsDisabled = !canAct || isSubmitting;
  const betAction = legal.has("open") ? "open" : "raise-to";
  const betLabel = legal.has("open") ? "오픈" : "레이즈";

  return (
    <section className={`game-module blind-card-duel ${state.phase}`} aria-label="인디언 포커 게임판">
      <header className="bcd-rule-rail">
        <span className="bcd-medallion" key={`hand-${state.handNumber}`} aria-hidden="true">{state.handNumber}</span>
        <div>
          <strong>{state.phase === "complete" ? "대결 종료" : `${state.handNumber}번째 손`}</strong>
          <small>{state.carriedFromTie ? "동률 팟 이월 중" : `${actor?.name ?? "정산"} ${actor ? "행동 차례" : "결과 확인"}`}</small>
        </div>
        <span className="bcd-shoe">남은 카드 {state.deckCount}</span>
      </header>

      <div className="bcd-table">
        <article className="bcd-player opponent" aria-label={`${opponentLabel} 영역`}>
          <div className="bcd-player-heading">
            <div><small>{opponentLabel} · 타임뱅크 {opponent?.timeBankSeconds ?? 0}초</small><strong>{opponent?.name ?? "빈 좌석"}</strong></div>
            <span>{chipLabel(opponent?.stack ?? 0)}</span>
          </div>
          <div
            key={`opponent-card-${state.handNumber}-${opponent?.visibleCardRank ?? "back"}`}
            className={`bcd-card ${opponent?.visibleCardRank ? "face" : "back"}`}
            role="img"
            aria-label={opponent?.visibleCardRank ? `${opponentLabel} 카드 ${opponent.visibleCardRank}` : `${opponentLabel}의 가려진 카드`}
          >
            <CardArtwork rank={opponent?.visibleCardRank} hiddenMark="✦" />
          </div>
          <p>이번 손 투입 <strong>{chipLabel(opponent?.contribution ?? 0)}</strong></p>
        </article>

        <div className="bcd-pot" aria-live="polite">
          <span className="bcd-medallion" aria-hidden="true">P</span>
          <small>테이블 팟</small>
          <strong className="bcd-pot-value" key={`pot-${state.pot}`}>{chipLabel(state.pot)}</strong>
          <span>현재 기준 {chipLabel(state.currentBetTo)}</span>
        </div>

        <article className="bcd-player self" aria-label={`${selfLabel} 영역`}>
          <div
            key={`self-card-${state.handNumber}-${state.cardsRevealed ? selfSeat?.visibleCardRank ?? "face" : "back"}`}
            className={`bcd-card ${state.cardsRevealed && selfSeat?.visibleCardRank ? "face" : "back"}`}
            role="img"
            aria-label={state.cardsRevealed && selfSeat?.visibleCardRank
              ? `${selfLabel} 카드 ${selfSeat.visibleCardRank}`
              : isSpectating ? `${selfLabel}의 가려진 카드` : "내 카드는 볼 수 없습니다"}
          >
            <CardArtwork rank={state.cardsRevealed ? selfSeat?.visibleCardRank : null} hiddenMark="?" />
          </div>
          <div className="bcd-player-heading">
            <div><small>{selfLabel} · 타임뱅크 {selfSeat?.timeBankSeconds ?? 0}초</small><strong>{selfSeat?.name ?? "빈 좌석"}</strong></div>
            <span>{chipLabel(selfSeat?.stack ?? 0)}</span>
          </div>
          <p>이번 손 투입 <strong>{chipLabel(selfSeat?.contribution ?? 0)}</strong></p>
        </article>
      </div>

      <p ref={messageRef} className="bcd-message" key={state.message} tabIndex={-1} data-bcd-focus-target="status" aria-live="polite">{state.message}</p>

      {state.phase === "betting" ? (
        <div className="bcd-actions" aria-label="베팅 행동">
          <button type="button" disabled={controlsDisabled || !legal.has("call")} onClick={() => submitAction({ type: "call" })}>콜 {state.callAmount > 0 ? chipLabel(state.callAmount) : ""}</button>
          <div className="bcd-raise-control">
            <label htmlFor="bcd-raise">{betLabel} 총액</label>
            <div>
              <button type="button" aria-label="베팅 총액 1 줄이기" disabled={controlsDisabled || raiseTo <= minRaise} onClick={() => setRaiseTo((value) => Math.max(minRaise, value - 1))}>−</button>
              <input id="bcd-raise" type="number" inputMode="numeric" min={minRaise} max={maxRaise} value={raiseTo} disabled={controlsDisabled || !legal.has(betAction)} onChange={(event) => setRaiseTo(Math.max(minRaise, Math.min(maxRaise, Number(event.target.value) || minRaise)))} />
              <button type="button" aria-label="베팅 총액 1 늘리기" disabled={controlsDisabled || raiseTo >= maxRaise} onClick={() => setRaiseTo((value) => Math.min(maxRaise, value + 1))}>+</button>
            </div>
            <button className="bcd-bet" type="button" disabled={controlsDisabled || !legal.has(betAction) || raiseTo < minRaise || raiseTo > maxRaise} onClick={() => submitAction({ type: betAction, payload: { to: raiseTo } })}>{betLabel} {chipLabel(raiseTo)}</button>
          </div>
          {confirmFold ? (
            <div className="bcd-fold-confirm" role="group" aria-label="폴드 확인">
              <span>이 손을 포기할까요?</span>
              <button
                ref={confirmFoldButtonRef}
                type="button"
                data-bcd-focus-target="fold-confirm"
                disabled={controlsDisabled}
                onClick={() => {
                  if (submitAction({ type: "fold" })) focusFoldResultRef.current = true;
                }}
              >폴드 확정</button>
              <button type="button" onClick={() => {
                focusFoldResultRef.current = false;
                restoreFoldFocusRef.current = true;
                setConfirmFold(false);
              }}>취소</button>
            </div>
          ) : (
            <button ref={foldButtonRef} className="bcd-fold" type="button" data-bcd-focus-target="fold" disabled={controlsDisabled || !legal.has("fold")} onClick={() => {
              focusFoldResultRef.current = false;
              setConfirmFold(true);
            }}>폴드</button>
          )}
        </div>
      ) : null}

      {state.winnerIds.length > 0 ? (
        <div className="bcd-winner" role="status">
          <span className="bcd-medallion" aria-hidden="true">勝</span>
          <strong>{state.players.filter((player) => state.winnerIds.includes(player.id)).map((player) => player.name).join(", ")} 승리</strong>
        </div>
      ) : null}
    </section>
  );
}
