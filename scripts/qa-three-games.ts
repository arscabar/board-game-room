import assert from "node:assert/strict";
import { module as blindModule, createBlindCardState, projectBlindCardState, type BlindCardState } from "../src/game-modules/blind-card-duel";
import { module as parityModule, createParityTileDeck, type ParityTileDuelState } from "../src/game-modules/parity-tile-duel";
import { cellsForPlacement, module as mosaicModule, mosaicChallengeCount, puzzleForMosaicChallenge, solutionForMosaicChallenge, validateMosaicSolution, type MosaicRushState } from "../src/game-modules/mosaic-rush";
import { getGameById } from "../src/shared/games";
import type { GameContext } from "../src/game-modules/types";
import type { PlayerSnapshot } from "../src/shared/types";

const avatar = { body: "pawn", face: "smile", accessory: "none", palette: "teal" } as const;

function players(count: number): PlayerSnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `테스터 ${index + 1}`,
    seat: index + 1,
    connected: true,
    isHost: index === 0,
    joinedAt: index,
    avatar
  }));
}

function context(gameId: string, playerList: PlayerSnapshot[], currentPlayerId: string, activePlayerId: string | null, now = 10_000): GameContext {
  const game = getGameById(gameId);
  assert(game, `${gameId} definition missing`);
  return { game, players: playerList, currentPlayerId, activePlayerId, turnNumber: 1, roundNumber: 1, rngSeed: "qa-seed", now };
}

function chipTotal(state: BlindCardState) {
  return Object.values(state.stacks).reduce((sum, value) => sum + value, 0) + state.pot;
}

function testBlindCard() {
  const playerList = players(2);
  const game = getGameById("blind-card-duel")!;
  const state = createBlindCardState({ game, players: playerList, rngSeed: "blind-qa", now: 1_000 });
  assert.equal(chipTotal(state), 60, "blind chip conservation at setup");
  const p1 = projectBlindCardState(state, "p1");
  assert.equal(p1.players.find((player) => player.id === "p1")?.visibleCardRank, null, "owner card must be masked");
  assert.notEqual(p1.players.find((player) => player.id === "p2")?.visibleCardRank, null, "opponent card must be visible");
  assert(projectBlindCardState(state, null).players.every((player) => player.visibleCardRank === null), "spectator must see no private card");

  const first = state.activePlayerId!;
  assert.throws(
    () => blindModule.applyAction(state, { type: "check" }, context("blind-card-duel", playerList, first, first)),
    /지원하지 않는/,
    "blind duel must not expose a check action"
  );
  const firstOutcome = blindModule.applyAction(state, { type: "open", payload: { to: 2 } }, context("blind-card-duel", playerList, first, first));
  const afterFirst = firstOutcome.state as BlindCardState;
  const second = afterFirst.activePlayerId!;
  const showdown = blindModule.applyAction(afterFirst, { type: "call" }, context("blind-card-duel", playerList, second, second)).state as BlindCardState;
  assert.equal(showdown.phase, "showdown");
  assert.equal(showdown.activePlayerId, null);
  const nextHand = blindModule.applySystemAction!(showdown, { type: "system/timeout", reason: "auto-timeout" }, context("blind-card-duel", playerList, "p1", null, 20_000)).state as BlindCardState;
  assert.equal(nextHand.phase, "betting", "showdown phase timeout must start a new hand");
  assert.equal(chipTotal(nextHand), 60, "blind chip conservation after showdown");

  const finalAnteState = structuredClone(showdown) as BlindCardState;
  finalAnteState.pot = 0;
  finalAnteState.stacks = { [playerList[0].id]: 1, [playerList[1].id]: 59 };
  const automaticShowdown = blindModule.applySystemAction!(
    finalAnteState,
    { type: "system/timeout", reason: "auto-timeout" },
    context("blind-card-duel", playerList, "p1", null, 30_000)
  ).state as BlindCardState;
  assert.notEqual(automaticShowdown.phase, "betting", "a final-chip ante must skip the impossible betting turn");
  assert.equal(automaticShowdown.activePlayerId, null);
  assert.equal(chipTotal(automaticShowdown), 60, "automatic all-in showdown must conserve chips");

  const forfeitureState = structuredClone(nextHand) as BlindCardState;
  const timedOutPlayer = forfeitureState.activePlayerId!;
  const banked = blindModule.applySystemAction!(
    forfeitureState,
    { type: "system/timeout", reason: "auto-timeout" },
    context("blind-card-duel", playerList, timedOutPlayer, timedOutPlayer, 40_000)
  ).state as BlindCardState;
  assert.equal(banked.phase, "betting", "first betting timeout must consume the time bank before forfeiting");
  assert.equal(banked.timeBankMs[timedOutPlayer], 0);
  const forfeitureReady = structuredClone(banked) as BlindCardState;
  forfeitureReady.timeBankMs[timedOutPlayer] = 0;
  forfeitureReady.timeoutStreaks[timedOutPlayer] = 1;
  const forfeiture = blindModule.applySystemAction!(
    forfeitureReady,
    { type: "system/timeout", reason: "auto-timeout" },
    context("blind-card-duel", playerList, timedOutPlayer, timedOutPlayer, 50_000)
  ).state as BlindCardState;
  assert.equal(forfeiture.phase, "complete", "second consecutive timeout must forfeit the match");
  assert.deepEqual(forfeiture.winnerIds, [playerList.find((player) => player.id !== timedOutPlayer)!.id]);
}

function countParityTiles(state: ParityTileDuelState) {
  let count = state.unusedTiles.length + Object.values(state.hands).reduce((sum, hand) => sum + hand.length, 0);
  for (const board of Object.values(state.boards)) {
    if (board.openingAttack) count += 1;
    for (const pair of board.pairs) {
      if (pair.defense) count += 1;
      if (pair.attack) count += 1;
    }
  }
  return count;
}

function testParityTile() {
  const deck = createParityTileDeck();
  assert.equal(deck.length, 38);
  for (let value = 1; value <= 8; value += 1) {
    assert.equal(deck.filter((tile) => tile.kind === "number" && tile.value === value).length, value);
  }

  for (const count of [2, 3, 4]) {
    const playerList = players(count);
    const state = parityModule.createInitialState({ game: getGameById("parity-tile-duel")!, players: playerList, rngSeed: `parity-${count}`, now: 1_000 }) as ParityTileDuelState;
    assert.equal(countParityTiles(state), 38, `${count}p parity tile conservation`);
    const ownView = parityModule.getPublicState(state, { ...context("parity-tile-duel", playerList, "p1", state.activePlayerId), viewerId: "p1" }) as any;
    const nullView = parityModule.getPublicState(state, { ...context("parity-tile-duel", playerList, "p1", state.activePlayerId), viewerId: null }) as any;
    assert.equal(ownView.hand.length, state.hands.p1.length);
    assert.equal(nullView.hand.length, 0, "spectator parity hand must be empty");

    const actor = state.activePlayerId!;
    const attacked = parityModule.applyAction(state, { type: "tile/attack", payload: { tileId: state.hands[actor][0].id } }, context("parity-tile-duel", playerList, actor, actor)).state as ParityTileDuelState;
    assert.equal(countParityTiles(attacked), 38, "attack must preserve all tiles");
    const responder = attacked.activePlayerId!;
    const timed = parityModule.applySystemAction!(attacked, { type: "system/timeout", reason: "auto-timeout" }, context("parity-tile-duel", playerList, responder, responder)).state as ParityTileDuelState;
    assert.equal(countParityTiles(timed), 38, "timeout pass must preserve all tiles");

    const roundEnding = structuredClone(state) as ParityTileDuelState;
    const finisher = roundEnding.activePlayerId!;
    const finishingTile = roundEnding.hands[finisher].find((tile) => tile.kind === "number" && tile.value >= 2)!;
    roundEnding.hands[finisher] = [finishingTile];
    const roundResult = parityModule.applyAction(
      roundEnding,
      { type: "tile/attack", payload: { tileId: finishingTile.id } },
      context("parity-tile-duel", playerList, finisher, finisher)
    ).state as ParityTileDuelState;
    assert.equal(roundResult.phase, "round-result", "non-final tile win must show the round result first");
    assert.equal(roundResult.activePlayerId, null);
    const nextRound = parityModule.applySystemAction!(
      roundResult,
      { type: "system/timeout", reason: "auto-timeout" },
      context("parity-tile-duel", playerList, finisher, null, 20_000)
    ).state as ParityTileDuelState;
    assert.equal(nextRound.phase, "choose-attack", "round-result timeout must set up the next round");
    assert.equal(nextRound.roundNumber, 2);

    if (count === 3) {
      const graceActor = state.activePlayerId!;
      const grace = parityModule.applySystemAction!(
        state,
        { type: "system/timeout", reason: "auto-timeout" },
        context("parity-tile-duel", playerList, graceActor, graceActor, 41_001)
      ).state as ParityTileDuelState;
      assert.equal(grace.phase, "choose-attack");
      assert.equal(grace.attackGracePlayerId, graceActor, "first attack timeout must start the 20-second grace period");
      const roundForfeit = parityModule.applySystemAction!(
        grace,
        { type: "system/timeout", reason: "auto-timeout" },
        context("parity-tile-duel", playerList, graceActor, graceActor, 61_002)
      ).state as ParityTileDuelState;
      assert.equal(roundForfeit.phase, "round-result");
      assert.equal(roundForfeit.roundForfeitPlayerId, graceActor);

      const repeatState = structuredClone(state) as ParityTileDuelState;
      repeatState.attackForfeitCounts[graceActor] = 1;
      repeatState.attackGracePlayerId = graceActor;
      const matchForfeit = parityModule.applySystemAction!(
        repeatState,
        { type: "system/timeout", reason: "auto-timeout" },
        context("parity-tile-duel", playerList, graceActor, graceActor, 81_003)
      ).state as ParityTileDuelState;
      assert.equal(matchForfeit.phase, "finished");
      assert.deepEqual(matchForfeit.winnerIds.sort(), playerList.map((player) => player.id).filter((id) => id !== graceActor).sort());
    }
  }
}

function mosaicContext(playerList: PlayerSnapshot[], current: string, now: number) {
  return context("mosaic-rush", playerList, current, null, now);
}

function placeMosaic(state: MosaicRushState, playerList: PlayerSnapshot[], type: string, payload?: unknown, now = 1_100) {
  return mosaicModule.applyAction(state, { type, payload, scopeId: state.scopeId }, mosaicContext(playerList, "p1", now)).state as MosaicRushState;
}

function testMosaic() {
  assert.equal(mosaicChallengeCount(), 144);
  const challengeShapes = new Set<string>();
  for (let card = 0; card < 24; card += 1) {
    for (let symbol = 0; symbol < 6; symbol += 1) {
      const cells = solutionForMosaicChallenge(card, symbol).flatMap(cellsForPlacement);
      const puzzle = puzzleForMosaicChallenge(card, symbol);
      assert(validateMosaicSolution(puzzle, solutionForMosaicChallenge(card, symbol)), `mosaic ${card}:${symbol} solution must validate`);
      assert.equal(new Set(cells.map(([x, y]) => `${x}:${y}`)).size, puzzle.target.length);
      challengeShapes.add(cells.map(([x, y]) => `${x}:${y}`).sort().join("|"));
    }
  }
  assert.equal(challengeShapes.size, 144, "all advertised mosaic challenges must have distinct targets");
  const solo = players(1);
  let state = mosaicModule.createInitialState({ game: getGameById("mosaic-rush")!, players: solo, rngSeed: "mosaic-qa", now: 1_000 }) as MosaicRushState;
  const nullView = mosaicModule.getPublicState(state, { ...mosaicContext(solo, "p1", 1_000), viewerId: null }) as any;
  assert.equal(nullView.puzzle, null);
  assert.deepEqual(nullView.placements, []);

  for (const placement of solutionForMosaicChallenge(state.puzzles.p1.card, state.puzzles.p1.symbol)) {
    state = placeMosaic(state, solo, "mosaic/place", placement);
  }
  state = placeMosaic(state, solo, "mosaic/submit", undefined, 1_200);
  assert.equal(state.phase, "reward", "solo valid exact cover should enter the visible reward phase");
  assert.equal(state.scores.p1, 4);
  state = mosaicModule.applySystemAction!(state, { type: "system/timeout", reason: "auto-timeout" }, mosaicContext(solo, "p1", 3_701)).state as MosaicRushState;
  assert.equal(state.round, 2, "reward timeout should advance to the next round");

  const fresh = mosaicModule.createInitialState({ game: getGameById("mosaic-rush")!, players: solo, rngSeed: "mosaic-timeout", now: 1_000 }) as MosaicRushState;
  const secondChance = mosaicModule.applySystemAction!(fresh, { type: "system/timeout", reason: "auto-timeout" }, mosaicContext(solo, "p1", 61_001)).state as MosaicRushState;
  assert.equal(secondChance.phase, "second-chance");
  const nextRound = mosaicModule.applySystemAction!(secondChance, { type: "system/timeout", reason: "auto-timeout" }, mosaicContext(solo, "p1", 121_002)).state as MosaicRushState;
  assert.equal(nextRound.phase, "reward");
  const advancedRound = mosaicModule.applySystemAction!(nextRound, { type: "system/timeout", reason: "auto-timeout" }, mosaicContext(solo, "p1", 123_503)).state as MosaicRushState;
  assert.equal(advancedRound.round, 2);

  const pair = players(2);
  const pairState = mosaicModule.createInitialState({ game: getGameById("mosaic-rush")!, players: pair, rngSeed: "mosaic-private", now: 1_000 }) as MosaicRushState;
  const moved = placeMosaic(pairState, pair, "mosaic/place", solutionForMosaicChallenge(pairState.puzzles.p1.card, pairState.puzzles.p1.symbol)[0]);
  const p2View = mosaicModule.getPublicState(moved, { ...mosaicContext(pair, "p2", 1_100), viewerId: "p2" }) as any;
  assert.deepEqual(p2View.placements, [], "other player placement must not be projected");

  let tieState: MosaicRushState = {
    ...pairState,
    round: 9,
    scores: { p1: 0, p2: 1 },
    solvedAt: { p1: 1_100, p2: 1_200 },
    solveSequence: { p1: 1, p2: 2 },
    interactivePlayerIds: []
  };
  tieState = mosaicModule.applySystemAction!(tieState, { type: "system/timeout", reason: "auto-timeout" }, mosaicContext(pair, "p1", 2_000)).state as MosaicRushState;
  assert.equal(tieState.phase, "reward");
  tieState = mosaicModule.applySystemAction!(tieState, { type: "system/timeout", reason: "auto-timeout" }, mosaicContext(pair, "p1", 4_501)).state as MosaicRushState;
  assert.equal(tieState.phase, "tie-break");
  assert.equal(tieState.tieBreakAttempt, 1);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    tieState = mosaicModule.applySystemAction!(tieState, { type: "system/timeout", reason: "auto-timeout" }, mosaicContext(pair, "p1", 3_000 + attempt * 2)).state as MosaicRushState;
    assert.equal(tieState.phase, "tie-break-second-chance");
    tieState = mosaicModule.applySystemAction!(tieState, { type: "system/timeout", reason: "auto-timeout" }, mosaicContext(pair, "p1", 3_001 + attempt * 2)).state as MosaicRushState;
    if (attempt < 3) {
      assert.equal(tieState.phase, "tie-break");
      assert.equal(tieState.tieBreakAttempt, attempt + 1);
    }
  }
  assert.equal(tieState.phase, "complete");
  assert.deepEqual(tieState.winnerIds.sort(), ["p1", "p2"]);
}

testBlindCard();
testParityTile();
testMosaic();

console.table([
  { game: "페이스업 듀얼", result: "베팅·칩 보존·역방향 카드 비공개·쇼다운 타이머" },
  { game: "문양 공방", result: "2/3/4인 배분·38타일 보존·손패 비공개·타임아웃" },
  { game: "모자이크 러시", result: "정확 덮기·동시 비공개·추가 기회·라운드 점수" }
]);
