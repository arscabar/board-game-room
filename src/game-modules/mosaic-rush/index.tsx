import { CheckCircle2, FlipHorizontal2, RotateCw, TimerReset, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const ROUND_MS = 60_000;
const ROUND_LIMIT = 9;

type Phase = "solving" | "second-chance" | "reward" | "tie-break" | "tie-break-second-chance" | "complete";
type Cell = [number, number];
type PieceId =
  | "beam-3"
  | "corner-3"
  | "square-4"
  | "tee-4"
  | "zig-4"
  | "hook-4"
  | "beam-4"
  | "cross-5"
  | "cup-5"
  | "pocket-5"
  | "vane-5"
  | "wave-5";

export interface Placement {
  pieceId: PieceId;
  x: number;
  y: number;
  rotation: number;
  flipped: boolean;
}

export interface PuzzleRef {
  id: string;
  card: number;
  symbol: number;
  target: Cell[];
  width: number;
  height: number;
  requiredPieceIds: [PieceId, PieceId, PieceId];
  difficulty: 1 | 2 | 3;
  generatorVersion: string;
}

export interface MosaicRushState {
  phase: Phase;
  activePlayerId: null;
  interactivePlayerIds: string[];
  playerIds: string[];
  round: number;
  roundLimit: number;
  phaseStartedAt: number;
  deadlineAt: number;
  decks: Record<string, number[]>;
  puzzles: Record<string, PuzzleRef>;
  placements: Record<string, Placement[]>;
  solvedAt: Record<string, number | null>;
  scores: Record<string, number>;
  lastRanks: string[];
  winnerIds: string[];
  scopeId: string;
  solveSequence: Record<string, number | null>;
  nextSolveSequence: number;
  tieBreakAttempt: number;
  competingPlayerIds: string[];
  seed: string;
  message: string;
}

interface PublicPlayer {
  id: string;
  score: number;
  solved: boolean;
  pieceCount: number;
}

interface MosaicRushPublicState {
  phase: Phase;
  round: number;
  roundLimit: number;
  deadlineAt: number;
  puzzle: PuzzleRef | null;
  placements: Placement[];
  players: PublicPlayer[];
  lastRanks: string[];
  winnerIds: string[];
  tieBreakAttempt: number;
  scopeId: string;
  canInteract: boolean;
  message: string;
}

const GENERATOR_VERSION = "mosaic-v2-144";

const pieces: Record<PieceId, Cell[]> = {
  "beam-3": [[0, 0], [1, 0], [2, 0]],
  "corner-3": [[0, 0], [0, 1], [1, 1]],
  "square-4": [[0, 0], [1, 0], [0, 1], [1, 1]],
  "tee-4": [[0, 0], [1, 0], [2, 0], [1, 1]],
  "zig-4": [[0, 0], [1, 0], [1, 1], [2, 1]],
  "hook-4": [[0, 0], [0, 1], [0, 2], [1, 2]],
  "beam-4": [[0, 0], [1, 0], [2, 0], [3, 0]],
  "cross-5": [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  "cup-5": [[0, 0], [0, 1], [1, 1], [2, 1], [2, 0]],
  "pocket-5": [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  "vane-5": [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  "wave-5": [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]]
};

const pieceLabels: Record<PieceId, string> = {
  "beam-3": "삼칸 막대",
  "corner-3": "작은 모서리",
  "square-4": "네칸 정사각",
  "tee-4": "네칸 받침",
  "zig-4": "네칸 지그재그",
  "hook-4": "네칸 갈고리",
  "beam-4": "네칸 막대",
  "cross-5": "다섯칸 십자",
  "cup-5": "다섯칸 컵",
  "pocket-5": "다섯칸 주머니",
  "vane-5": "다섯칸 날개",
  "wave-5": "다섯칸 물결"
};

const pieceVisuals: Record<PieceId, { mark: string; background: string }> = {
  "beam-3": { mark: "I3", background: "repeating-linear-gradient(45deg,#e7aa36,#e7aa36 8px,#f0c35f 8px,#f0c35f 16px)" },
  "corner-3": { mark: "L3", background: "radial-gradient(circle,#fff5 2px,transparent 3px),#c8604d" },
  "square-4": { mark: "O4", background: "linear-gradient(90deg,#4f7db0 50%,#6f9bc9 50%)" },
  "tee-4": { mark: "T4", background: "repeating-linear-gradient(0deg,#6f5da8 0 7px,#8e7ac5 7px 14px)" },
  "zig-4": { mark: "Z4", background: "repeating-linear-gradient(90deg,#3f8b6b 0 6px,#66ad8d 6px 12px)" },
  "hook-4": { mark: "L4", background: "radial-gradient(circle at 30% 30%,#ffe8a8 0 3px,transparent 4px),#b66b35" },
  "beam-4": { mark: "I4", background: "repeating-linear-gradient(135deg,#315f85 0 8px,#5686aa 8px 16px)" },
  "cross-5": { mark: "X5", background: "radial-gradient(circle,#f6d66d 0 3px,#805c21 4px 6px,#c49332 7px)" },
  "cup-5": { mark: "U5", background: "repeating-linear-gradient(0deg,#9e4c68 0 5px,#c86f8a 5px 10px)" },
  "pocket-5": { mark: "P5", background: "linear-gradient(45deg,#426d63 25%,#6b9b8d 25% 50%,#426d63 50% 75%,#6b9b8d 75%)" },
  "vane-5": { mark: "V5", background: "repeating-radial-gradient(circle,#d87b3f 0 3px,#9e4a2c 4px 7px)" },
  "wave-5": { mark: "W5", background: "repeating-linear-gradient(45deg,#49799b 0 5px,#77a6bf 5px 10px)" }
};

function hashSeed(seed: string) {
  let value = 2166136261;
  for (const character of seed) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function randomFrom(seed: string) {
  let value = hashSeed(seed) || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function shuffledDeck(seed: string) {
  const deck = Array.from({ length: 24 }, (_, index) => index);
  const random = randomFrom(seed);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function normalizeCells(cells: Cell[]) {
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells.map(([x, y]) => [x - minX, y - minY] as Cell);
}

export function cellsForPlacement(placement: Placement): Cell[] {
  const base = pieces[placement.pieceId];
  let cells = base.map(([x, y]) => [placement.flipped ? -x : x, y] as Cell);
  const turns = ((placement.rotation % 4) + 4) % 4;
  for (let turn = 0; turn < turns; turn += 1) {
    cells = cells.map(([x, y]) => [-y, x]);
  }
  return normalizeCells(cells).map(([x, y]) => [x + placement.x, y + placement.y]);
}

interface ChallengeBankEntry {
  id: string;
  card: number;
  symbol: number;
  target: Cell[];
  width: number;
  height: number;
  requiredPieceIds: [PieceId, PieceId, PieceId];
  difficulty: 1 | 2 | 3;
  solution: Placement[];
}

function cellKey([x, y]: Cell) {
  return `${x}:${y}`;
}

function orientationsFor(pieceId: PieceId) {
  const candidates = new Map<string, Placement>();
  for (let rotation = 0; rotation < 4; rotation += 1) {
    for (const flipped of [false, true]) {
      const placement = { pieceId, x: 0, y: 0, rotation, flipped };
      candidates.set(cellsForPlacement(placement).map(cellKey).sort().join("|"), placement);
    }
  }
  return [...candidates.values()];
}

function connected(cells: Cell[]) {
  const remaining = new Set(cells.map(cellKey));
  const first = remaining.values().next().value as string | undefined;
  if (!first) return false;
  const queue = [first];
  remaining.delete(first);
  while (queue.length > 0) {
    const [x, y] = queue.shift()!.split(":").map(Number);
    for (const neighbor of [`${x + 1}:${y}`, `${x - 1}:${y}`, `${x}:${y + 1}`, `${x}:${y - 1}`]) {
      if (remaining.delete(neighbor)) queue.push(neighbor);
    }
  }
  return remaining.size === 0;
}

function buildChallengeBank() {
  const pieceIds = Object.keys(pieces) as PieceId[];
  const triples: Array<[PieceId, PieceId, PieceId]> = [];
  for (let first = 0; first < pieceIds.length - 2; first += 1) {
    for (let second = first + 1; second < pieceIds.length - 1; second += 1) {
      for (let third = second + 1; third < pieceIds.length; third += 1) {
        triples.push([pieceIds[first], pieceIds[second], pieceIds[third]]);
      }
    }
  }
  const shuffle = randomFrom(`${GENERATOR_VERSION}:triples`);
  for (let index = triples.length - 1; index > 0; index -= 1) {
    const target = Math.floor(shuffle() * (index + 1));
    [triples[index], triples[target]] = [triples[target], triples[index]];
  }

  const signatures = new Set<string>();
  const bank: ChallengeBankEntry[] = [];
  for (let challengeIndex = 0; challengeIndex < 144; challengeIndex += 1) {
    const requiredPieceIds = triples[challengeIndex] as [PieceId, PieceId, PieceId];
    const random = randomFrom(`${GENERATOR_VERSION}:challenge:${challengeIndex}`);
    let created: ChallengeBankEntry | null = null;
    for (let attempt = 0; attempt < 4_000 && !created; attempt += 1) {
      const placements: Placement[] = [];
      const occupied: Cell[] = [];
      for (const pieceId of requiredPieceIds) {
        const orientations = orientationsFor(pieceId);
        const orientation = orientations[Math.floor(random() * orientations.length)];
        if (occupied.length === 0) {
          const placement = { ...orientation, x: 0, y: 0 };
          placements.push(placement);
          occupied.push(...cellsForPlacement(placement));
          continue;
        }
        const occupiedKeys = new Set(occupied.map(cellKey));
        const boundary = occupied.flatMap(([x, y]) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as Cell[])
          .filter((cell, index, all) => !occupiedKeys.has(cellKey(cell)) && all.findIndex((entry) => cellKey(entry) === cellKey(cell)) === index);
        let placed = false;
        for (let attachAttempt = 0; attachAttempt < 80 && !placed; attachAttempt += 1) {
          const anchor = boundary[Math.floor(random() * boundary.length)];
          const orientationCells = cellsForPlacement(orientation);
          const attachCell = orientationCells[Math.floor(random() * orientationCells.length)];
          const placement = { ...orientation, x: anchor[0] - attachCell[0], y: anchor[1] - attachCell[1] };
          const cells = cellsForPlacement(placement);
          if (cells.some((cell) => occupiedKeys.has(cellKey(cell)))) continue;
          const union = [...occupied, ...cells];
          const width = Math.max(...union.map(([x]) => x)) - Math.min(...union.map(([x]) => x)) + 1;
          const height = Math.max(...union.map(([, y]) => y)) - Math.min(...union.map(([, y]) => y)) + 1;
          if (width > 7 || height > 7) continue;
          placements.push(placement);
          occupied.push(...cells);
          placed = true;
        }
        if (!placed) break;
      }
      if (placements.length !== 3 || !connected(occupied)) continue;
      const minX = Math.min(...occupied.map(([x]) => x));
      const minY = Math.min(...occupied.map(([, y]) => y));
      const target = occupied.map(([x, y]) => [x - minX, y - minY] as Cell);
      const width = Math.max(...target.map(([x]) => x)) + 1;
      const height = Math.max(...target.map(([, y]) => y)) + 1;
      if (width < 3 || height < 3) continue;
      const signature = target.map(cellKey).sort().join("|");
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      const card = Math.floor(challengeIndex / 6);
      const symbol = challengeIndex % 6;
      created = {
        id: `mosaic-${card + 1}-${symbol + 1}`,
        card,
        symbol,
        target,
        width,
        height,
        requiredPieceIds,
        difficulty: ((symbol % 3) + 1) as 1 | 2 | 3,
        solution: placements.map((placement) => ({ ...placement, x: placement.x - minX, y: placement.y - minY }))
      };
    }
    if (!created) throw new Error(`모자이크 퍼즐 ${challengeIndex + 1}을 생성하지 못했습니다.`);
    bank.push(created);
  }
  return bank;
}

const challengeBank = buildChallengeBank();

function challenge(card: number, symbol: number): PuzzleRef {
  const entry = challengeBank[(card * 6 + symbol) % challengeBank.length];
  return {
    id: entry.id,
    card,
    symbol,
    target: entry.target.map((cell) => [...cell] as Cell),
    width: entry.width,
    height: entry.height,
    requiredPieceIds: [...entry.requiredPieceIds],
    difficulty: entry.difficulty,
    generatorVersion: GENERATOR_VERSION
  };
}

export function puzzleForMosaicChallenge(card: number, symbol: number) {
  return challenge(card, symbol);
}

export function solutionForMosaicChallenge(card: number, symbol: number) {
  const entry = challengeBank[(card * 6 + symbol) % challengeBank.length];
  return entry.solution.map((placement) => ({ ...placement }));
}

export function mosaicChallengeCount() {
  return challengeBank.length;
}

export function validateMosaicSolution(puzzle: PuzzleRef, placements: Placement[]) {
  const required = new Set(puzzle.requiredPieceIds);
  if (
    placements.length !== puzzle.requiredPieceIds.length ||
    new Set(placements.map((entry) => entry.pieceId)).size !== puzzle.requiredPieceIds.length ||
    placements.some((entry) => !required.has(entry.pieceId))
  ) {
    return false;
  }
  const target = new Set(puzzle.target.map(([x, y]) => `${x}:${y}`));
  const occupied = new Set<string>();
  for (const placement of placements) {
    for (const [x, y] of cellsForPlacement(placement)) {
      const key = `${x}:${y}`;
      if (!target.has(key) || occupied.has(key)) return false;
      occupied.add(key);
    }
  }
  return occupied.size === target.size;
}

function startTieBreak(state: MosaicRushState, now: number, competitors: string[], attempt: number): MosaicRushState {
  const puzzles = Object.fromEntries(
    competitors.map((id) => [id, challenge(state.decks[id][ROUND_LIMIT + attempt - 1], (ROUND_LIMIT + attempt - 1) % 6)])
  );
  return {
    ...state,
    phase: "tie-break",
    phaseStartedAt: now,
    deadlineAt: now + ROUND_MS,
    puzzles,
    placements: Object.fromEntries(state.playerIds.map((id) => [id, []])),
    solvedAt: Object.fromEntries(state.playerIds.map((id) => [id, null])),
    solveSequence: Object.fromEntries(state.playerIds.map((id) => [id, null])),
    nextSolveSequence: 1,
    interactivePlayerIds: [...competitors],
    competingPlayerIds: [...competitors],
    tieBreakAttempt: attempt,
    winnerIds: [],
    scopeId: `tie-break:${attempt}:first`,
    message: `동점 결승 ${attempt}/3. 동점 장인만 새 퍼즐에 도전합니다.`
  };
}

function completeTieBreak(state: MosaicRushState, message: string): MosaicRushState {
  const solved = state.competingPlayerIds
    .filter((id) => state.solveSequence[id] !== null)
    .sort((left, right) => (state.solveSequence[left] ?? Infinity) - (state.solveSequence[right] ?? Infinity));
  const fastest = solved[0] ? state.solveSequence[solved[0]] : null;
  const winnerIds = fastest === null
    ? [...state.competingPlayerIds]
    : solved.filter((id) => state.solveSequence[id] === fastest);
  return { ...state, phase: "complete", interactivePlayerIds: [], winnerIds, message };
}

function nextPuzzleState(state: MosaicRushState, now: number): MosaicRushState {
  const nextRound = state.round + 1;
  if (nextRound > state.roundLimit) {
    const highScore = Math.max(...Object.values(state.scores));
    const winnerIds = state.playerIds.filter((id) => state.scores[id] === highScore);
    if (winnerIds.length > 1) return startTieBreak(state, now, winnerIds, 1);
    return { ...state, phase: "complete", interactivePlayerIds: [], winnerIds, message: "모자이크 장인이 결정되었습니다." };
  }
  const puzzles = Object.fromEntries(
    state.playerIds.map((id) => [id, challenge(state.decks[id][nextRound - 1], (nextRound - 1) % 6)])
  );
  return {
    ...state,
    phase: "solving",
    round: nextRound,
    phaseStartedAt: now,
    deadlineAt: now + ROUND_MS,
    puzzles,
    placements: Object.fromEntries(state.playerIds.map((id) => [id, []])),
    solvedAt: Object.fromEntries(state.playerIds.map((id) => [id, null])),
    solveSequence: Object.fromEntries(state.playerIds.map((id) => [id, null])),
    nextSolveSequence: 1,
    interactivePlayerIds: [...state.playerIds],
    competingPlayerIds: [],
    scopeId: `round:${nextRound}:first`,
    message: `${nextRound}라운드 퍼즐이 펼쳐졌습니다.`
  };
}

function settleRound(state: MosaicRushState, now: number): MosaicRushState {
  const ranks = state.playerIds
    .filter((id) => state.solveSequence[id] !== null)
    .sort((left, right) => (state.solveSequence[left] ?? Infinity) - (state.solveSequence[right] ?? Infinity));
  const rewards = [4, 3, 2, 1];
  const scores = { ...state.scores };
  ranks.forEach((id, index) => {
    scores[id] += rewards[index] ?? 0;
  });
  return {
    ...state,
    phase: "reward",
    scores,
    lastRanks: ranks,
    interactivePlayerIds: [],
    phaseStartedAt: now,
    deadlineAt: now + 2_500,
    scopeId: `round:${state.round}:reward`,
    message: ranks.length > 0 ? "라운드 순위와 점수를 확인하세요." : "이번 라운드에는 완성자가 없습니다."
  };
}

function publicState(state: MosaicRushState, viewerId: string | null): MosaicRushPublicState {
  return {
    phase: state.phase,
    round: state.round,
    roundLimit: state.roundLimit,
    deadlineAt: state.deadlineAt,
    puzzle: viewerId ? state.puzzles[viewerId] ?? null : null,
    placements: viewerId ? state.placements[viewerId] ?? [] : [],
    players: state.playerIds.map((id) => ({
      id,
      score: state.scores[id],
      solved: state.solvedAt[id] !== null,
      pieceCount: id === viewerId ? state.placements[id]?.length ?? 0 : 0
    })),
    lastRanks: [...state.lastRanks],
    winnerIds: [...state.winnerIds],
    tieBreakAttempt: state.tieBreakAttempt,
    scopeId: state.scopeId,
    canInteract: Boolean(viewerId && state.interactivePlayerIds.includes(viewerId)),
    message: state.message
  };
}

function applyAction(state: MosaicRushState, action: GameAction, context: GameContext): GameActionResult {
  if (state.phase === "complete") throw new Error("이미 끝난 게임입니다.");
  if (action.scopeId !== state.scopeId) throw new Error("이전 퍼즐 단계의 행동입니다. 현재 퍼즐에서 다시 시도해주세요.");
  const playerId = context.currentPlayerId;
  if (!state.playerIds.includes(playerId)) throw new Error("참가자만 퍼즐을 조작할 수 있습니다.");
  if (!state.interactivePlayerIds.includes(playerId)) throw new Error("현재 퍼즐에 참여 중인 플레이어만 조작할 수 있습니다.");
  if (state.solvedAt[playerId] !== null) throw new Error("이미 완성한 퍼즐입니다.");
  if ((context.now ?? Date.now()) > state.deadlineAt) throw new Error("이 단계의 제한 시간이 끝났습니다.");
  const payload = (action.payload ?? {}) as Partial<Placement>;

  if (action.type === "mosaic/place") {
    if (!payload.pieceId || !(payload.pieceId in pieces)) throw new Error("조각을 선택해주세요.");
    if (![payload.x, payload.y, payload.rotation].every(Number.isInteger)) throw new Error("놓을 위치가 올바르지 않습니다.");
    const placement: Placement = {
      pieceId: payload.pieceId as PieceId,
      x: Number(payload.x),
      y: Number(payload.y),
      rotation: Number(payload.rotation),
      flipped: Boolean(payload.flipped)
    };
    const others = state.placements[playerId].filter((entry) => entry.pieceId !== placement.pieceId);
    const cells = cellsForPlacement(placement);
    const target = new Set(state.puzzles[playerId].target.map(([x, y]) => `${x}:${y}`));
    const occupied = new Set(others.flatMap(cellsForPlacement).map(([x, y]) => `${x}:${y}`));
    if (cells.some(([x, y]) => !target.has(`${x}:${y}`) || occupied.has(`${x}:${y}`))) {
      throw new Error("조각은 목표 안에서 서로 겹치지 않게 놓아주세요.");
    }
    const placements = { ...state.placements, [playerId]: [...others, placement] };
    return { state: { ...state, placements }, interactivePlayerIds: state.interactivePlayerIds };
  }

  if (action.type === "mosaic/remove") {
    if (!payload.pieceId || !(payload.pieceId in pieces)) throw new Error("제거할 조각이 없습니다.");
    return {
      state: {
        ...state,
        placements: {
          ...state.placements,
          [playerId]: state.placements[playerId].filter((entry) => entry.pieceId !== payload.pieceId)
        }
      },
      interactivePlayerIds: state.interactivePlayerIds
    };
  }

  if (action.type === "mosaic/submit") {
    if (!validateMosaicSolution(state.puzzles[playerId], state.placements[playerId])) {
      throw new Error("아직 목표 칸을 정확히 채우지 못했습니다.");
    }
    const now = context.now ?? Date.now();
    const solvedAt = { ...state.solvedAt, [playerId]: now };
    const solveSequence = { ...state.solveSequence, [playerId]: state.nextSolveSequence };
    const competitors = state.competingPlayerIds.length > 0 ? state.competingPlayerIds : state.playerIds;
    const allSolved = competitors.every((id) => solvedAt[id] !== null);
    if (allSolved) {
      const solvedState = { ...state, solvedAt, solveSequence, nextSolveSequence: state.nextSolveSequence + 1 };
      const settled = state.phase.startsWith("tie-break")
        ? completeTieBreak(solvedState, "동점 결승의 가장 빠른 장인이 승리했습니다.")
        : settleRound(solvedState, now);
      return {
        state: settled,
        phase: settled.phase,
        roundNumber: settled.round,
        interactivePlayerIds: settled.interactivePlayerIds,
        winnerIds: settled.winnerIds,
        resetTimer: true,
        log: "퍼즐 완성"
      };
    }
    const interactivePlayerIds = competitors.filter((id) => solvedAt[id] === null);
    return {
      state: {
        ...state,
        solvedAt,
        solveSequence,
        nextSolveSequence: state.nextSolveSequence + 1,
        interactivePlayerIds,
        message: "완성 확인! 다른 장인의 결과를 기다립니다."
      },
      interactivePlayerIds,
      log: "퍼즐 완성"
    };
  }

  throw new Error("지원하지 않는 퍼즐 행동입니다.");
}

export const module: GameModule = {
  id: "mosaic-rush",
  concurrencyMode: "phase-scoped",
  timerMode: "phase",
  getTimerDurationMs: (state) => (state as MosaicRushState).phase === "reward" ? 2_500 : ROUND_MS,
  createInitialState: ({ players, rngSeed, now }) => {
    const seed = rngSeed ?? "mosaic-rush";
    const startedAt = now ?? Date.now();
    const playerIds = players.map((player) => player.id);
    const decks = Object.fromEntries(playerIds.map((id) => [id, shuffledDeck(`${seed}:${id}`)]));
    return {
      phase: "solving",
      activePlayerId: null,
      interactivePlayerIds: [...playerIds],
      playerIds,
      round: 1,
      roundLimit: ROUND_LIMIT,
      phaseStartedAt: startedAt,
      deadlineAt: startedAt + ROUND_MS,
      decks,
      puzzles: Object.fromEntries(playerIds.map((id) => [id, challenge(decks[id][0], 0)])),
      placements: Object.fromEntries(playerIds.map((id) => [id, []])),
      solvedAt: Object.fromEntries(playerIds.map((id) => [id, null])),
      solveSequence: Object.fromEntries(playerIds.map((id) => [id, null])),
      nextSolveSequence: 1,
      scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
      lastRanks: [],
      winnerIds: [],
      tieBreakAttempt: 0,
      competingPlayerIds: [],
      scopeId: "round:1:first",
      seed,
      message: "세 조각으로 이번 카드의 모자이크 윤곽을 완성하세요."
    } satisfies MosaicRushState;
  },
  getPublicState: (state, context) => publicState(state as MosaicRushState, context.viewerId),
  applyAction: (state, action, context) => applyAction(state as MosaicRushState, action, context),
  applySystemAction: (rawState, action, context) => {
    const state = rawState as MosaicRushState;
    if (action.type !== "system/timeout" || state.phase === "complete") return { state };
    const now = context.now ?? Date.now();
    if (state.phase === "reward") {
      const next = nextPuzzleState(state, now);
      return {
        state: next,
        phase: next.phase,
        roundNumber: next.round,
        interactivePlayerIds: next.interactivePlayerIds,
        winnerIds: next.winnerIds,
        resetTimer: true,
        log: "모자이크 다음 라운드"
      };
    }
    const competitors = state.competingPlayerIds.length > 0 ? state.competingPlayerIds : state.playerIds;
    const hasSolver = competitors.some((id) => state.solvedAt[id] !== null);
    if (state.phase === "solving" && !hasSolver) {
      const next = {
        ...state,
        phase: "second-chance" as const,
        phaseStartedAt: now,
        deadlineAt: now + ROUND_MS,
        scopeId: `round:${state.round}:second`,
        message: "아무도 완성하지 못했습니다. 배치를 유지한 채 60초를 더 드립니다."
      };
      return { state: next, phase: next.phase, interactivePlayerIds: next.interactivePlayerIds, resetTimer: true, log: "추가 기회 시작" };
    }
    if (state.phase === "tie-break" && !hasSolver) {
      const next = {
        ...state,
        phase: "tie-break-second-chance" as const,
        phaseStartedAt: now,
        deadlineAt: now + ROUND_MS,
        scopeId: `tie-break:${state.tieBreakAttempt}:second`,
        message: "동점 결승 추가 기회입니다. 현재 배치를 유지합니다."
      };
      return { state: next, phase: next.phase, interactivePlayerIds: next.interactivePlayerIds, resetTimer: true, log: "동점 결승 추가 기회" };
    }
    if (state.phase.startsWith("tie-break")) {
      const settled = hasSolver
        ? completeTieBreak(state, "동점 결승 제한 시간 안에 완성한 장인이 승리했습니다.")
        : state.tieBreakAttempt >= 3
          ? completeTieBreak(state, "세 번의 결승 뒤에도 승부가 나지 않아 공동 우승입니다.")
          : startTieBreak(state, now, competitors, state.tieBreakAttempt + 1);
      return {
        state: settled,
        phase: settled.phase,
        interactivePlayerIds: settled.interactivePlayerIds,
        winnerIds: settled.winnerIds,
        resetTimer: true,
        log: "모자이크 동점 결승 정산"
      };
    }
    const settled = settleRound(state, now);
    return {
      state: settled,
      phase: settled.phase,
      roundNumber: settled.round,
      interactivePlayerIds: settled.interactivePlayerIds,
      winnerIds: settled.winnerIds,
      resetTimer: true,
      log: "모자이크 라운드 정산"
    };
  }
};

export function Component({ players, currentPlayer, publicState: rawState, disabled, onAction }: GameComponentProps<MosaicRushPublicState>) {
  const state = rawState as MosaicRushPublicState;
  const [pieceId, setPieceId] = useState<PieceId>(state.puzzle?.requiredPieceIds[0] ?? "beam-3");
  const [rotation, setRotation] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const placedByCell = useMemo(() => {
    const map = new Map<string, PieceId>();
    state.placements.forEach((placement) => cellsForPlacement(placement).forEach(([x, y]) => map.set(`${x}:${y}`, placement.pieceId)));
    return map;
  }, [state.placements]);
  const targetCells = useMemo(() => new Set((state.puzzle?.target ?? []).map(cellKey)), [state.puzzle]);
  const gridWidth = state.puzzle?.width ?? 3;
  const gridHeight = state.puzzle?.height ?? 3;
  const me = state.players.find((player) => player.id === currentPlayer?.id);
  const controlsDisabled = disabled || !state.canInteract || Boolean(me?.solved) || state.phase === "complete" || state.phase === "reward";
  const rankedPlayers = useMemo(
    () => [...state.players].sort((left, right) => right.score - left.score || players.findIndex((player) => player.id === left.id) - players.findIndex((player) => player.id === right.id)),
    [players, state.players]
  );

  useEffect(() => {
    const firstRequired = state.puzzle?.requiredPieceIds[0];
    if (firstRequired) setPieceId(firstRequired);
    setRotation(0);
    setFlipped(false);
  }, [state.puzzle?.id]);

  return (
    <section className="mosaic-rush" data-player-count={state.players.length} aria-label="모자이크 러시 게임판">
      <header className="mosaic-rush__header">
        <div><span className="mosaic-rush__medallion">{state.phase.startsWith("tie-break") ? "T" : state.round}</span><p>{state.phase.startsWith("tie-break") ? `TIE BREAK ${state.tieBreakAttempt} / 3` : `ROUND ${state.round} / ${state.roundLimit}`}</p><h2>모자이크 러시</h2></div>
        <p className="mosaic-rush__message" aria-live="polite">{state.message}</p>
      </header>

      <div className="mosaic-rush__layout">
        <div className="mosaic-rush__workbench">
          <div className="mosaic-rush__target-title"><TimerReset size={18} /> 목표 문양 {state.puzzle ? state.puzzle.symbol + 1 : "비공개"}</div>
          <div className="mosaic-rush__grid" role="grid" aria-label={`${gridWidth} 곱하기 ${gridHeight} 퍼즐 격자`} style={{ gridTemplateColumns: `repeat(${gridWidth}, 1fr)` }}>
            {Array.from({ length: gridWidth * gridHeight }, (_, index) => {
              const x = index % gridWidth;
              const y = Math.floor(index / gridWidth);
              const occupant = placedByCell.get(`${x}:${y}`);
              const isTarget = targetCells.has(`${x}:${y}`);
              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className={`mosaic-rush__cell ${!isTarget ? "is-blocked" : ""} ${occupant ? `is-${occupant}` : ""}`}
                  style={!isTarget ? { opacity: 0.18, boxShadow: "none" } : occupant ? { background: pieceVisuals[occupant].background } : undefined}
                  disabled={!isTarget || controlsDisabled}
                  aria-label={`${y + 1}행 ${x + 1}열${!isTarget ? ", 목표 밖" : occupant ? `, ${pieceLabels[occupant]}` : ", 빈칸"}`}
                  onClick={() => onAction({ type: "mosaic/place", payload: { pieceId, x, y, rotation, flipped } })}
                >{occupant ? pieceVisuals[occupant].mark : ""}</button>
              );
            })}
          </div>

          <div className="mosaic-rush__tools" aria-label="퍼즐 도구">
            {(state.puzzle?.requiredPieceIds ?? []).map((id) => (
              <button key={id} type="button" aria-pressed={pieceId === id} className={pieceId === id ? "is-selected" : ""} onClick={() => setPieceId(id)}>{pieceLabels[id]}</button>
            ))}
            <button type="button" disabled={controlsDisabled} onClick={() => setRotation((value) => (value + 1) % 4)}><RotateCw size={17} /> 회전</button>
            <button type="button" disabled={controlsDisabled} aria-pressed={flipped} onClick={() => setFlipped((value) => !value)}><FlipHorizontal2 size={17} /> 뒤집기</button>
            <button type="button" disabled={controlsDisabled} onClick={() => onAction({ type: "mosaic/remove", payload: { pieceId } })}><Undo2 size={17} /> 선택 조각 회수</button>
          </div>
          <button className="mosaic-rush__submit" type="button" disabled={controlsDisabled} onClick={() => onAction({ type: "mosaic/submit" })}>
            <CheckCircle2 size={20} /> {me?.solved ? "완성 확인됨" : "모자이크 완성 확인"}
          </button>
        </div>

        <aside className="mosaic-rush__score" aria-label="장인 점수">
          <h3>장인 기록</h3>
          {rankedPlayers.map((entry, index) => {
            const player = players.find((candidate) => candidate.id === entry.id);
            return <div className="mosaic-rush__player" key={entry.id}><span className="mosaic-rush__rank">{index + 1}</span><strong>{player?.name ?? "플레이어"}</strong><span>{entry.score}점</span><em>{entry.solved ? "완성" : "작업 중"}</em></div>;
          })}
          <details><summary>배치 규칙</summary><p>화면에 표시된 세 조각을 겹치지 않게 사용해 모든 목표 칸을 채우세요. 조각을 고른 뒤 격자의 기준 칸을 누릅니다.</p></details>
        </aside>
      </div>
    </section>
  );
}
