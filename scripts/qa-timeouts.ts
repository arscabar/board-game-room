import { module as blokusModule } from "../src/game-modules/blokus";
import { module as davinciModule } from "../src/game-modules/davinci-code-plus";
import { module as yachtModule } from "../src/game-modules/yacht-dice";
import type { GameContext } from "../src/game-modules/types";
import { getGameById } from "../src/shared/games";
import type { PlayerSnapshot } from "../src/shared/types";

function players(count: number): PlayerSnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `P${index + 1}`,
    seat: index + 1,
    connected: true,
    isHost: index === 0,
    joinedAt: index + 1
  }));
}

function context(
  gameId: string,
  gamePlayers: PlayerSnapshot[],
  currentPlayerId: string,
  activePlayerId: string | null = currentPlayerId,
  turnNumber = 1,
  roundNumber = 1
): GameContext {
  const game = getGameById(gameId);
  if (!game) {
    throw new Error(`Unknown game: ${gameId}`);
  }

  return {
    game,
    players: gamePlayers,
    currentPlayerId,
    activePlayerId,
    turnNumber,
    roundNumber
  };
}

function game(gameId: string) {
  const definition = getGameById(gameId);
  if (!definition) {
    throw new Error(`Unknown game: ${gameId}`);
  }
  return definition;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn: () => unknown, message: string) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function firstHiddenTarget(state: any, playerId: string) {
  const player = state.players.find((candidate: any) => candidate.id === playerId);
  const tileIndex = player.hand.findIndex((tile: any) => !tile.revealed);
  const tile = player.hand[tileIndex];
  assert(tile, `No hidden tile for ${playerId}`);
  return { tileIndex, guess: tile.kind === "joker" ? "joker" : tile.value };
}

function runDavinciDrawTimeoutUsesPenalty() {
  const gamePlayers = players(4);
  let state = davinciModule.createInitialState({ game: game("davinci-code-plus"), players: gamePlayers }) as any;
  state = davinciModule.applyAction(
    state,
    { type: "draw" },
    context("davinci-code-plus", gamePlayers, "p1", "p1")
  ).state as any;
  const drawnTileId = state.drawnTileId;
  assert(drawnTileId, "다빈치: 드로우 후 drawnTileId가 없습니다.");

  state = davinciModule.applySystemAction!(
    state,
    { type: "system/timeout", reason: "auto-timeout" },
    context("davinci-code-plus", gamePlayers, "p1", "p1")
  ).state as any;
  const p1 = state.players.find((player: any) => player.id === "p1");

  assert(state.activePlayerId !== "p1", "다빈치: 타임아웃 후 같은 플레이어 차례가 남았습니다.");
  assert(state.drawnTileId === null, "다빈치: 타임아웃 후 drawnTileId가 초기화되지 않았습니다.");
  assert(p1.usedBonusCards === 1, "다빈치: 드로우 후 타임아웃이 보너스 카드 페널티를 소모하지 않았습니다.");
  return "드로우 후 타임아웃은 자동 오답 페널티";
}

function runDavinciManualPassBlockedDuringGuess() {
  const gamePlayers = players(4);
  let state = davinciModule.createInitialState({ game: game("davinci-code-plus"), players: gamePlayers }) as any;
  state = davinciModule.applyAction(
    state,
    { type: "draw" },
    context("davinci-code-plus", gamePlayers, "p1", "p1")
  ).state as any;

  assertThrows(
    () =>
      davinciModule.applySystemAction!(
        state,
        { type: "system/pass", reason: "manual-pass" },
        context("davinci-code-plus", gamePlayers, "p1", "p1")
      ),
    "다빈치: 추측 단계에서 수동 턴 종료가 차단되지 않았습니다."
  );
  return "추측 단계 수동 턴 종료 차단";
}

function runDavinciDecideTimeoutPassesTurn() {
  const gamePlayers = players(4);
  let state = davinciModule.createInitialState({ game: game("davinci-code-plus"), players: gamePlayers }) as any;
  state = davinciModule.applyAction(
    state,
    { type: "draw" },
    context("davinci-code-plus", gamePlayers, "p1", "p1")
  ).state as any;
  const target = firstHiddenTarget(state, "p2");
  state = davinciModule.applyAction(
    state,
    {
      type: "guess",
      payload: { targetPlayerId: "p2", tileIndex: target.tileIndex, guess: target.guess }
    },
    context("davinci-code-plus", gamePlayers, "p1", "p1")
  ).state as any;
  assert(state.phase === "decide", "다빈치: 정답 후 결정 단계로 들어가지 않았습니다.");

  state = davinciModule.applySystemAction!(
    state,
    { type: "system/timeout", reason: "auto-timeout" },
    context("davinci-code-plus", gamePlayers, "p1", "p1")
  ).state as any;

  assert(state.activePlayerId !== "p1", "다빈치: 결정 단계 타임아웃 후 턴이 넘어가지 않았습니다.");
  assert(state.currentStreak === 0, "다빈치: 결정 단계 타임아웃 후 연속 정답 수가 초기화되지 않았습니다.");
  assert(state.drawnTileId === null, "다빈치: 결정 단계 타임아웃 후 drawnTileId가 초기화되지 않았습니다.");
  return "결정 단계 타임아웃은 안전한 패스";
}

function runYachtTimeoutScoresOpenCategory() {
  const gamePlayers = players(3);
  let state = yachtModule.createInitialState({ game: game("yacht-dice"), players: gamePlayers }) as any;
  state = yachtModule.applyAction(state, { type: "yacht-dice/roll" }, context("yacht-dice", gamePlayers, "p1", "p1")).state as any;
  state.dice = [6, 6, 6, 6, 6];

  state = yachtModule.applySystemAction!(
    state,
    { type: "system/timeout", reason: "auto-timeout" },
    context("yacht-dice", gamePlayers, "p1", "p1")
  ).state as any;

  assert(state.activePlayerId === "p2", "요트: 타임아웃 후 다음 플레이어로 넘어가지 않았습니다.");
  assert(state.rollsThisTurn === 0, "요트: 타임아웃 후 굴림 횟수가 초기화되지 않았습니다.");
  assert(state.scores.p1.ones === 0, "요트: 타임아웃이 가장 낮은 가능 점수칸을 자동 기록하지 않았습니다.");
  return "시간 초과 시 가장 낮은 가능 점수칸 자동 기록";
}

function runYachtManualPassBlocked() {
  const gamePlayers = players(3);
  let state = yachtModule.createInitialState({ game: game("yacht-dice"), players: gamePlayers }) as any;
  state = yachtModule.applyAction(state, { type: "yacht-dice/roll" }, context("yacht-dice", gamePlayers, "p1", "p1")).state as any;

  assertThrows(
    () =>
      yachtModule.applySystemAction!(
        state,
        { type: "system/pass", reason: "manual-pass" },
        context("yacht-dice", gamePlayers, "p1", "p1")
      ),
    "요트: 점수 기록 없는 수동 턴 종료가 차단되지 않았습니다."
  );
  return "점수 기록 없는 수동 턴 종료 차단";
}

function runBlokusManualPassBlockedWhenMoveExists() {
  const gamePlayers = players(4);
  const state = blokusModule.createInitialState({ game: game("blokus"), players: gamePlayers }) as any;

  assertThrows(
    () =>
      blokusModule.applySystemAction!(
        state,
        { type: "system/pass", reason: "manual-pass" },
        context("blokus", gamePlayers, "p1", "p1")
      ),
    "블로커스: 둘 수 있는 조각이 있는데 수동 패스가 차단되지 않았습니다."
  );
  return "둘 수 있는 조각이 있으면 수동 패스 차단";
}

function runBlokusTimeoutAdvancesTurn() {
  const gamePlayers = players(4);
  let state = blokusModule.createInitialState({ game: game("blokus"), players: gamePlayers }) as any;
  state = blokusModule.applySystemAction!(
    state,
    { type: "system/timeout", reason: "auto-timeout" },
    context("blokus", gamePlayers, "p1", "p1")
  ).state as any;

  assert(state.activeColorId !== "p1:color-1", "블로커스: 타임아웃 후 색상 차례가 넘어가지 않았습니다.");
  return "시간 초과 시 색상 차례 넘김";
}

const results = [
  { game: "다빈치 코드 플러스", result: runDavinciDrawTimeoutUsesPenalty() },
  { game: "다빈치 코드 플러스", result: runDavinciManualPassBlockedDuringGuess() },
  { game: "다빈치 코드 플러스", result: runDavinciDecideTimeoutPassesTurn() },
  { game: "요트 다이스", result: runYachtTimeoutScoresOpenCategory() },
  { game: "요트 다이스", result: runYachtManualPassBlocked() },
  { game: "블로커스", result: runBlokusManualPassBlockedWhenMoveExists() },
  { game: "블로커스", result: runBlokusTimeoutAdvancesTurn() }
];

console.table(results);
