import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Component as BlindCardComponent, module as blindModule, createBlindCardState, projectBlindCardState, type BlindCardState } from "../src/game-modules/blind-card-duel";
import { Component as ParityTileComponent, canDefend, module as parityModule, createParityTileDeck, tileLabel, type ParityTileDuelState } from "../src/game-modules/parity-tile-duel";
import type { ParityTile } from "../src/game-modules/parity-tile-duel/battlefields";
import { Component as MosaicRushComponent, cellsForPlacement, module as mosaicModule, mosaicChallengeCount, puzzleForMosaicChallenge, solutionForMosaicChallenge, validateMosaicSolution, type MosaicRushState } from "../src/game-modules/mosaic-rush";
import { getGameById } from "../src/shared/games";
import type { GameContext } from "../src/game-modules/types";
import type { PlayerSnapshot } from "../src/shared/types";

// The production Vite transform injects the JSX runtime. The tsx-based SSR
// regression below needs the same global while rendering game components.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

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
  const spectatorMarkup = renderToStaticMarkup(createElement(BlindCardComponent, {
    game,
    players: playerList,
    currentPlayer: null,
    activePlayer: null,
    publicState: projectBlindCardState(state, null),
    disabled: true,
    onAction: () => undefined
  }));
  assert(playerList.every((player) => spectatorMarkup.includes(player.name)), "blind spectator UI must render both real seats");
  assert.equal((spectatorMarkup.match(/role="img"/g) ?? []).length, 2, "blind cards must expose reliable image semantics");
  assert.match(spectatorMarkup, /aria-label="플레이어 1의 가려진 카드"/, "blind spectator must not receive player one's private rank");
  assert.match(spectatorMarkup, /aria-label="플레이어 2의 가려진 카드"/, "blind spectator must not receive player two's private rank");
  assert.match(spectatorMarkup, /data-bcd-focus-target="status"/, "blind status message must remain an explicit focus destination");

  const longNamePlayers = playerList.map((player, index) => ({ ...player, name: `LONGPLAYER${index + 1}ABCDE` }));
  const longNameState = createBlindCardState({ game, players: longNamePlayers, rngSeed: "blind-long-name", now: 1_001 });
  const longNameMarkup = renderToStaticMarkup(createElement(BlindCardComponent, {
    game,
    players: longNamePlayers,
    currentPlayer: null,
    activePlayer: null,
    publicState: projectBlindCardState(longNameState, null),
    disabled: true,
    onAction: () => undefined
  }));
  assert(longNamePlayers.every((player) => longNameMarkup.includes(player.name)), "blind spectator UI must preserve both long player names");

  const blindCss = readFileSync(new URL("../src/game-modules/ui-styles/blind-card-duel.css", import.meta.url), "utf8");
  assert.match(blindCss, /\.bcd-actions button, \.bcd-actions input \{[^}]*min-height:\s*44px/s, "blind actions must retain 44px touch targets");
  assert.match(blindCss, /container-type:\s*inline-size/, "blind layout must respond to its available container width");
  assert.match(blindCss, /@container \(max-width:\s*820px\)/, "blind actions must adapt to a narrow parent container");
  assert.match(blindCss, /\.bcd-actions \{[^}]*minmax\(0,\s*2fr\)[^}]*min-width:\s*0/s, "blind action grid must shrink without page overflow");
  assert.match(blindCss, /\.bcd-winner strong \{[^}]*overflow-wrap:\s*anywhere/s, "blind winner names must wrap safely");
  assert.match(blindCss, /\.bcd-message:focus-visible/, "blind fold result focus destination must have a visible indicator");

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

function acknowledgeParityBattlefield(state: ParityTileDuelState, playerList: PlayerSnapshot[]) {
  let next = state;
  assert.equal(next.phase, "battlefield-reveal", "parity match must reveal its battlefield before play");
  assert.equal(parityModule.getTimerDurationMs?.(next), null, "battlefield explanation must not consume the attack timer");

  const firstPlayer = playerList[0];
  const firstAttackTile = next.hands[firstPlayer.id][0];
  assert(firstAttackTile, "the first parity player must have an attack tile");
  assert.throws(
    () => parityModule.applyAction(
      next,
      { type: "tile/attack", payload: { tileId: firstAttackTile.id } },
      context("parity-tile-duel", playerList, firstPlayer.id, next.activePlayerId)
    ),
    /전장 환경을 먼저 확인/,
    "players must not attack before acknowledging the battlefield"
  );

  next = parityModule.applyAction(
    next,
    { type: "tile/acknowledge-battlefield" },
    context("parity-tile-duel", playerList, firstPlayer.id, next.activePlayerId)
  ).state as ParityTileDuelState;
  assert.equal(next.phase, "battlefield-reveal", "one acknowledgement must not start a multiplayer match");
  assert.equal(parityModule.getTimerDurationMs?.(next), null, "partial acknowledgement must not start the attack timer");
  assert.throws(
    () => parityModule.applyAction(
      next,
      { type: "tile/acknowledge-battlefield" },
      context("parity-tile-duel", playerList, firstPlayer.id, next.activePlayerId)
    ),
    /이미 전장 환경을 확인/,
    "the same player must not acknowledge a battlefield twice"
  );
  assert.throws(
    () => parityModule.applyAction(
      next,
      { type: "tile/attack", payload: { tileId: firstAttackTile.id } },
      context("parity-tile-duel", playerList, firstPlayer.id, next.activePlayerId)
    ),
    /전장 환경을 먼저 확인/,
    "an acknowledged player must still wait for every other player"
  );

  for (const player of playerList.slice(1)) {
    next = parityModule.applyAction(
      next,
      { type: "tile/acknowledge-battlefield" },
      context("parity-tile-duel", playerList, player.id, next.activePlayerId)
    ).state as ParityTileDuelState;
  }
  assert.equal(next.phase, "battlefield-applying", "all acknowledgements must enter the authoritative battlefield application phase");
  assert.equal(next.battlefieldAcknowledgedPlayerIds.length, playerList.length);
  assert.equal(next.activePlayerId, null, "battlefield application must not expose an active player");
  assert.deepEqual(next.interactivePlayerIds, [], "battlefield application must not expose interactive players");
  assert.equal(parityModule.getTimerDurationMs?.(next), 800, "battlefield application must last exactly 800ms");
  const applyingView = parityModule.getPublicState(next, {
    ...context("parity-tile-duel", playerList, firstPlayer.id, null),
    viewerId: firstPlayer.id
  }) as any;
  assert.equal(applyingView.phase, "battlefield-applying", "public state must expose the environment application phase");
  assert.equal(applyingView.activePlayerId, null);
  assert.deepEqual(applyingView.interactivePlayerIds, []);
  assert.throws(
    () => parityModule.applyAction(
      next,
      { type: "tile/attack", payload: { tileId: firstAttackTile.id } },
      context("parity-tile-duel", playerList, firstPlayer.id, next.activePlayerId)
    ),
    /현재 행동할 차례가 아닙니다/,
    "players must not attack while the battlefield is being applied"
  );
  next = parityModule.applySystemAction!(
    next,
    { type: "system/timeout", reason: "auto-timeout" },
    context("parity-tile-duel", playerList, firstPlayer.id, null, 1_800)
  ).state as ParityTileDuelState;
  assert.equal(next.phase, "choose-attack", "the battlefield application timeout must start the first attack");
  assert.equal(next.activePlayerId, next.startPlayerId);
  assert.deepEqual(next.interactivePlayerIds, next.startPlayerId ? [next.startPlayerId] : []);
  assert.equal(parityModule.getTimerDurationMs?.(next), 40_000, "the attack timer must start as a fresh 40 seconds");
  return next;
}

function testParityTile() {
  const tiger: ParityTile = { id: "even-special", kind: "even-special" };
  const dragon: ParityTile = { id: "odd-special", kind: "odd-special" };
  const two: ParityTile = { id: "number-2-qa", kind: "number", value: 2 };
  const three: ParityTile = { id: "number-3-qa", kind: "number", value: 3 };
  assert.equal(tileLabel(tiger), "호랑이 특수 타일");
  assert.equal(tileLabel(dragon), "용 특수 타일");
  assert(canDefend(two, tiger) && canDefend(tiger, two), "호랑이와 짝수 숫자는 양방향으로 방어해야 함");
  assert(!canDefend(three, tiger), "호랑이는 홀수 숫자를 방어할 수 없어야 함");
  assert(canDefend(three, dragon) && canDefend(dragon, three), "용과 홀수 숫자는 양방향으로 방어해야 함");
  assert(!canDefend(two, dragon), "용은 짝수 숫자를 방어할 수 없어야 함");

  const deck = createParityTileDeck();
  assert.equal(deck.length, 38);
  for (let value = 1; value <= 8; value += 1) {
    assert.equal(deck.filter((tile) => tile.kind === "number" && tile.value === value).length, value);
  }

  for (const count of [2, 3, 4]) {
    const playerList = players(count);
    const preparedState = parityModule.createInitialState({ game: getGameById("parity-tile-duel")!, players: playerList, rngSeed: `parity-${count}`, now: 1_000 }) as ParityTileDuelState;
    const state = acknowledgeParityBattlefield(preparedState, playerList);
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
      const finishedView = parityModule.getPublicState(matchForfeit, {
        ...context("parity-tile-duel", playerList, "p1", null),
        viewerId: "p1"
      }) as any;
      const finishedMarkup = renderToStaticMarkup(createElement(ParityTileComponent, {
        game: getGameById("parity-tile-duel")!,
        players: playerList,
        currentPlayer: playerList[0],
        activePlayer: null,
        publicState: finishedView,
        disabled: true,
        onAction: () => undefined
      }));
      assert(finishedMarkup.includes("최종 대결 결과"), "finished parity UI must render the result panel");
      assert(!finishedMarkup.includes("선택 타일로 공격"), "finished parity UI must not render stale attack controls");
    }
  }

  const parityUiSource = readFileSync(new URL("../src/game-modules/parity-tile-duel/index.tsx", import.meta.url), "utf8");
  assert.match(parityUiSource, /createPortal\(/, "parity battlefield explanation must use an app-level portal");
  assert.match(parityUiSource, /new MutationObserver\(/, "parity modal must protect body siblings added after it opens");
  assert.match(parityUiSource, /backgroundObserver\.disconnect\(\)/, "parity modal must disconnect its body observer during cleanup");
  assert.match(parityUiSource, /addEventListener\("focusin", keepFocusInPortal, true\)/, "parity modal must contain programmatic focus");
  assert.match(parityUiSource, /removeEventListener\("focusin", keepFocusInPortal, true\)/, "parity modal must clean up its focus containment listener");
  assert.match(parityUiSource, /battlefieldReturnFocusRef\.current = trigger/, "parity modal must remember the actual opener");
  assert.match(parityUiSource, /scheduleBattlefieldFocus\(\(\) => trigger\)/, "parity modal must return focus to its opener");
  assert.match(parityUiSource, /cancelAnimationFrame\(battlefieldFocusFrameRef\.current\)/, "parity modal must cancel stale focus restoration frames");
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
  let tallPuzzle: ReturnType<typeof puzzleForMosaicChallenge> | null = null;
  for (let card = 0; card < 24; card += 1) {
    for (let symbol = 0; symbol < 6; symbol += 1) {
      const cells = solutionForMosaicChallenge(card, symbol).flatMap(cellsForPlacement);
      const puzzle = puzzleForMosaicChallenge(card, symbol);
      if (puzzle.height > puzzle.width && (!tallPuzzle || puzzle.height / puzzle.width > tallPuzzle.height / tallPuzzle.width)) {
        tallPuzzle = puzzle;
      }
      assert(validateMosaicSolution(puzzle, solutionForMosaicChallenge(card, symbol)), `mosaic ${card}:${symbol} solution must validate`);
      assert.equal(new Set(cells.map(([x, y]) => `${x}:${y}`)).size, puzzle.target.length);
      challengeShapes.add(cells.map(([x, y]) => `${x}:${y}`).sort().join("|"));
    }
  }
  assert.equal(challengeShapes.size, 144, "all advertised mosaic challenges must have distinct targets");
  assert(tallPuzzle, "mosaic challenge bank must contain a tall non-square puzzle");
  const mosaicCss = readFileSync(new URL("../src/game-modules/ui-styles/mosaic-rush.css", import.meta.url), "utf8");
  assert.equal((mosaicCss.match(/^\.mosaic-rush\s*\{/gm) ?? []).length, 1, "mosaic CSS must keep one readable root rule");
  assert.match(mosaicCss, /\.mosaic-rush__grid-scroll\s*\{[^}]*overflow-x:\s*auto/s, "mosaic board overflow must stay internal");
  assert.match(mosaicCss, /min-inline-size:\s*calc\(var\(--mosaic-columns\) \* 44px\)/, "mosaic grid must reserve 44px per column");
  assert.match(mosaicCss, /\.mosaic-rush__cell\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px[^}]*aspect-ratio:\s*1/s, "mosaic cells must remain square 44px targets");
  assert.match(mosaicCss, /@media \(max-width:\s*760px\)/, "mosaic CSS must retain the 768px-adjacent layout breakpoint");
  assert.match(mosaicCss, /@media \(max-width:\s*400px\)/, "mosaic CSS must retain the 360px layout breakpoint");
  assert.match(mosaicCss, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none !important;[\s\S]*transition:\s*none !important;/, "mosaic reduced-motion contract must disable animation and transition");
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
  const rewardView = mosaicModule.getPublicState(state, { ...mosaicContext(solo, "p1", 1_200), viewerId: "p1" }) as any;
  const rewardMarkup = renderToStaticMarkup(createElement(MosaicRushComponent, {
    game: getGameById("mosaic-rush")!,
    players: solo,
    currentPlayer: solo[0],
    activePlayer: null,
    publicState: rewardView,
    disabled: true,
    onAction: () => undefined
  }));
  assert(rewardMarkup.includes("1라운드 완성 순위"), "mosaic reward UI must render the round ranking heading");
  assert(rewardMarkup.includes(solo[0].name) && rewardMarkup.includes("+4점"), "mosaic reward UI must render the ranked player and reward");
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
  const p1InitialView = mosaicModule.getPublicState(pairState, { ...mosaicContext(pair, "p1", 1_000), viewerId: "p1" }) as any;
  const mosaicMarkup = renderToStaticMarkup(createElement(MosaicRushComponent, {
    game: getGameById("mosaic-rush")!,
    players: pair,
    currentPlayer: pair[0],
    activePlayer: null,
    publicState: p1InitialView,
    disabled: false,
    onAction: () => undefined
  }));
  assert(
    mosaicMarkup.includes(`--mosaic-aspect:${p1InitialView.puzzle.width} / ${p1InitialView.puzzle.height}`),
    "mosaic UI must preserve the puzzle width/height aspect ratio"
  );
  assert(mosaicMarkup.includes("--mosaic-fit-width:"), "mosaic UI must constrain tall boards without distorting cells");
  assert(mosaicMarkup.includes("0도 · 기본 면"), "mosaic UI must expose the selected piece orientation");
  assert(mosaicMarkup.includes("aria-pressed=\"false\""), "mosaic UI must expose the unflipped toggle state");
  const tallMarkup = renderToStaticMarkup(createElement(MosaicRushComponent, {
    game: getGameById("mosaic-rush")!,
    players: pair,
    currentPlayer: pair[0],
    activePlayer: null,
    publicState: { ...p1InitialView, puzzle: tallPuzzle },
    disabled: false,
    onAction: () => undefined
  }));
  const expectedTallFitWidth = Math.min(430, (430 * tallPuzzle.width) / tallPuzzle.height);
  assert(
    tallMarkup.includes(`--mosaic-fit-width:${expectedTallFitWidth}px`),
    "mosaic UI must constrain a tall puzzle by its width/height ratio"
  );
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
  const completeView = mosaicModule.getPublicState(tieState, { ...mosaicContext(pair, "p1", 3_100), viewerId: "p1" }) as any;
  const completeMarkup = renderToStaticMarkup(createElement(MosaicRushComponent, {
    game: getGameById("mosaic-rush")!,
    players: pair,
    currentPlayer: pair[0],
    activePlayer: null,
    publicState: completeView,
    disabled: true,
    onAction: () => undefined
  }));
  assert(completeMarkup.includes("최종 우승"), "mosaic complete UI must render the final winner heading");
  assert(
    completeMarkup.includes(`${pair[0].name}, ${pair[1].name} 장인이 우승했습니다.`),
    "mosaic complete UI must name every joint winner"
  );
}

testBlindCard();
testParityTile();
testMosaic();

console.table([
  { game: "인디언 포커", result: "베팅·칩 보존·역방향 카드 비공개·쇼다운 타이머" },
  { game: "타이거 앤 드래곤", result: "2/3/4인 배분·38타일 보존·손패 비공개·타임아웃" },
  { game: "우봉고", result: "정확 덮기·동시 비공개·추가 기회·라운드 점수" }
]);
