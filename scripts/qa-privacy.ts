import { module as davinciModule } from "../src/game-modules/davinci-code-plus";
import { module as ghostsModule } from "../src/game-modules/ghosts";
import { module as guryongtuModule } from "../src/game-modules/guryongtu";
import { module as hangmanModule } from "../src/game-modules/hangman-board-game";
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function game(gameId: string) {
  const definition = getGameById(gameId);
  if (!definition) {
    throw new Error(`Unknown game: ${gameId}`);
  }
  return definition;
}

function runGuryongtuPrivacy() {
  const gamePlayers = players(2);
  const state = guryongtuModule.createInitialState({ game: game("guryongtu"), players: gamePlayers });
  const after = guryongtuModule.applyAction(
    state,
    { type: "guryongtu/select-tile", payload: { tile: 7 } },
    context("guryongtu", gamePlayers, "p1")
  ).state;
  const p1View = guryongtuModule.getPublicState(after, {
    ...context("guryongtu", gamePlayers, "p1", "p2"),
    viewerId: "p1"
  }) as any;
  const p2View = guryongtuModule.getPublicState(after, {
    ...context("guryongtu", gamePlayers, "p2"),
    viewerId: "p2"
  }) as any;

  assert(p1View.pendingChoices.p1.tile === 7, "구룡투: 본인 선택 타일이 본인에게 보이지 않습니다.");
  assert(p2View.pendingChoices.p1.selected === true, "구룡투: 상대 선택 완료 여부가 보이지 않습니다.");
  assert(p2View.pendingChoices.p1.tile === null, "구룡투: 상대에게 비공개 선택 타일이 노출됩니다.");
  return "비공개 선택 타일 보호";
}

function runGhostsPrivacy() {
  const gamePlayers = players(2);
  const setup = ["bad", "good", "good", "bad", "good", "bad", "bad", "good"];
  let state = ghostsModule.createInitialState({ game: game("ghosts"), players: gamePlayers });
  state = ghostsModule.applyAction(
    state,
    { type: "ghosts/setup", payload: { kinds: setup } },
    context("ghosts", gamePlayers, "p1", "p1")
  ).state;
  state = ghostsModule.applyAction(
    state,
    { type: "ghosts/setup", payload: { kinds: setup } },
    context("ghosts", gamePlayers, "p2", "p2")
  ).state;
  const p1View = ghostsModule.getPublicState(state, {
    ...context("ghosts", gamePlayers, "p1"),
    viewerId: "p1"
  }) as any;
  const p2View = ghostsModule.getPublicState(state, {
    ...context("ghosts", gamePlayers, "p2", "p1"),
    viewerId: "p2"
  }) as any;

  assert(
    p1View.pieces.filter((piece: any) => piece.ownerId === "p1").every((piece: any) => piece.kind === "good" || piece.kind === "bad"),
    "고스트: 본인 유령 정체가 본인에게 보이지 않습니다."
  );
  assert(
    p1View.pieces.filter((piece: any) => piece.ownerId === "p2").every((piece: any) => piece.kind === null),
    "고스트: P1에게 상대 유령 정체가 노출됩니다."
  );
  assert(
    p2View.pieces.filter((piece: any) => piece.ownerId === "p1").every((piece: any) => piece.kind === null),
    "고스트: P2에게 상대 유령 정체가 노출됩니다."
  );
  return "상대 유령 정체 보호";
}

function runDavinciPrivacy() {
  const gamePlayers = players(4);
  const state = davinciModule.createInitialState({ game: game("davinci-code-plus"), players: gamePlayers });
  const p1View = davinciModule.getPublicState(state, {
    ...context("davinci-code-plus", gamePlayers, "p1"),
    viewerId: "p1"
  }) as any;
  const p2View = davinciModule.getPublicState(state, {
    ...context("davinci-code-plus", gamePlayers, "p2", "p1"),
    viewerId: "p2"
  }) as any;
  const p1OwnRack = p1View.players.find((player: any) => player.id === "p1");
  const p1RackSeenByP2 = p2View.players.find((player: any) => player.id === "p1");

  assert(
    p1OwnRack.hand.some((tile: any) => tile.value !== null || tile.kind === "joker"),
    "다빈치 코드 플러스: 본인 타일 값이 본인에게 보이지 않습니다."
  );
  assert(
    p1RackSeenByP2.hand.every(
      (tile: any) =>
        tile.value === null &&
        tile.kind === null &&
        !String(tile.id).includes("black") &&
        !String(tile.id).includes("white") &&
        !String(tile.id).includes("red")
    ),
    "다빈치 코드 플러스: 상대 타일 값/종류/원본 ID가 노출됩니다."
  );
  assert(
    p1RackSeenByP2.hand.every((tile: any) => ["black", "white", "red", "joker"].includes(tile.color)),
    "다빈치 코드 플러스: 상대 타일 색 단서가 숨겨져 실물 추리감이 떨어집니다."
  );
  return "상대 타일 값/종류/ID 보호";
}

function runHangmanPrivacy() {
  const gamePlayers = players(2);
  let state = hangmanModule.createInitialState({ game: game("hangman-board-game"), players: gamePlayers });
  state = hangmanModule.applyAction(
    state,
    { type: "hangman-board-game/setup-secret", payload: { word: "APPLE" } },
    context("hangman-board-game", gamePlayers, "p1", null)
  ).state;
  state = hangmanModule.applyAction(
    state,
    { type: "hangman-board-game/setup-secret", payload: { word: "BERRY" } },
    context("hangman-board-game", gamePlayers, "p2", null)
  ).state;
  const p1View = hangmanModule.getPublicState(state, {
    ...context("hangman-board-game", gamePlayers, "p1"),
    viewerId: "p1"
  }) as any;
  const p2View = hangmanModule.getPublicState(state, {
    ...context("hangman-board-game", gamePlayers, "p2", "p1"),
    viewerId: "p2"
  }) as any;

  assert(p1View.setup.ownSecret === "APPLE", "행맨: 본인 비밀 단어가 본인에게 보이지 않습니다.");
  assert(p2View.setup.ownSecret === "BERRY", "행맨: 본인 비밀 단어가 P2에게 보이지 않습니다.");
  assert(!JSON.stringify(p1View).includes("BERRY"), "행맨: P1에게 P2 비밀 단어가 노출됩니다.");
  assert(!JSON.stringify(p2View).includes("APPLE"), "행맨: P2에게 P1 비밀 단어가 노출됩니다.");
  return "상대 비밀 단어 보호";
}

function runConnectedPlayerFiltering() {
  const gamePlayers = players(4);
  gamePlayers[0].connected = false;
  const guryongtu = guryongtuModule.createInitialState({ game: game("guryongtu"), players: gamePlayers }) as any;
  const hangman = hangmanModule.createInitialState({ game: game("hangman-board-game"), players: gamePlayers }) as any;
  const yacht = yachtModule.createInitialState({ game: game("yacht-dice"), players: gamePlayers }) as any;

  for (const state of [guryongtu, hangman, yacht]) {
    assert(!state.playerIds.includes("p1"), "연결 끊긴 1번 좌석이 게임 참가자에 포함됩니다.");
  }

  assert(guryongtu.playerIds.join(",") === "p2,p3", "구룡투: 접속 중인 낮은 좌석 2명을 선택하지 않았습니다.");
  assert(hangman.playerIds.join(",") === "p2,p3", "행맨: 접속 중인 낮은 좌석 2명을 선택하지 않았습니다.");
  assert(yacht.playerIds.join(",") === "p2,p3,p4", "요트: 접속 중인 플레이어만 점수표에 들어가지 않았습니다.");
  return "연결 중인 플레이어만 게임 참가";
}

const results = [
  { game: "구룡투", result: runGuryongtuPrivacy() },
  { game: "고스트", result: runGhostsPrivacy() },
  { game: "다빈치 코드 플러스", result: runDavinciPrivacy() },
  { game: "행맨 보드게임", result: runHangmanPrivacy() },
  { game: "공통 시작 필터", result: runConnectedPlayerFiltering() }
];

console.table(results);
