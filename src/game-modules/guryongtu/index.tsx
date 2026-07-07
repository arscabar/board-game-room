import type { CSSProperties } from "react";
import type { GameAction, GameComponentProps, GameContext, GameModule } from "../types";
import type { PlayerSnapshot } from "../../shared/types";
import { useInteractionGate } from "../useInteractionGate";

const TILES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

type Tile = (typeof TILES)[number];
type TileColor = "black" | "white";

interface RevealedRound {
  roundNumber: number;
  attackerId: string | null;
  tiles: Record<string, Tile>;
  winnerId: string | null;
  reason: string;
}

interface GuryongtuState {
  playerIds: string[];
  activePlayerId: string | null;
  attackerId: string | null;
  phase: "selecting" | "complete";
  choices: Record<string, Tile | null>;
  usedTiles: Record<string, Tile[]>;
  scores: Record<string, number>;
  rounds: RevealedRound[];
  winnerId: string | null;
}

interface PublicChoice {
  selected: boolean;
  tile: Tile | null;
  color: TileColor | null;
}

interface PublicPlayedTile {
  color: TileColor;
  tile: Tile | null;
}

interface PublicRevealedRound {
  roundNumber: number;
  attackerId: string | null;
  plays: Record<string, PublicPlayedTile>;
  winnerId: string | null;
  reason: string;
}

interface GuryongtuPublicState {
  playerIds: string[];
  activePlayerId: string | null;
  attackerId: string | null;
  phase: "selecting" | "complete";
  pendingChoices: Record<string, PublicChoice>;
  usedTiles: Record<string, Tile[]>;
  remainingTiles: Record<string, Tile[]>;
  playedStacks: Record<string, PublicPlayedTile[]>;
  scores: Record<string, number>;
  rounds: PublicRevealedRound[];
  winnerId: string | null;
}

const styles: Record<string, CSSProperties> = {
  shell: {
    display: "grid",
    gap: "1rem",
    width: "100%"
  },
  statusGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.75rem"
  },
  panel: {
    border: "1px solid rgba(148, 163, 184, 0.35)",
    borderRadius: 8,
    padding: "0.85rem",
    background: "rgba(255, 255, 255, 0.78)"
  },
  tileGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(3rem, 1fr))",
    gap: "0.35rem"
  },
  tileButton: {
    minHeight: "2.75rem",
    borderRadius: 8,
    border: "1px solid rgba(15, 23, 42, 0.2)",
    fontWeight: 700
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    alignItems: "center"
  },
};

function orderedPlayers(players: PlayerSnapshot[], count: number) {
  return [...players]
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat || a.joinedAt - b.joinedAt)
    .slice(0, count)
    .map((player) => player.id);
}

function makeRecord<T>(playerIds: string[], value: () => T) {
  const record: Record<string, T> = {};
  for (const playerId of playerIds) {
    record[playerId] = value();
  }
  return record;
}

function readTile(action: GameAction): Tile | null {
  const raw =
    typeof action.payload === "object" && action.payload !== null && "tile" in action.payload
      ? (action.payload as { tile?: unknown }).tile
      : action.payload;

  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 9) {
    return null;
  }

  return raw as Tile;
}

function tileColor(tile: Tile): TileColor {
  return tile % 2 === 0 ? "black" : "white";
}

function tileColorLabel(color: TileColor | null) {
  if (color === "black") return "흑";
  if (color === "white") return "백";
  return "비공개";
}

function compareTiles(firstTile: Tile, secondTile: Tile) {
  if (firstTile === secondTile) {
    return 0;
  }
  if (firstTile === 1 && secondTile === 9) {
    return 1;
  }
  if (firstTile === 9 && secondTile === 1) {
    return -1;
  }
  return firstTile > secondTile ? 1 : -1;
}

function roundReason(firstTile: Tile, secondTile: Tile, result: number) {
  if (result === 0) {
    return "같은 숫자라 무승부입니다.";
  }
  if ((firstTile === 1 && secondTile === 9) || (firstTile === 9 && secondTile === 1)) {
    return "1이 9를 이기는 예외 규칙으로 승부가 났습니다.";
  }
  return "더 높은 숫자가 라운드를 이겼습니다.";
}

function publicRoundReason(round: RevealedRound) {
  const values = Object.values(round.tiles);
  const result = values.length >= 2 ? compareTiles(values[0], values[1]) : 0;
  if (result === 0) {
    return "같은 힘이라 무승부입니다.";
  }
  if ((values[0] === 1 && values[1] === 9) || (values[0] === 9 && values[1] === 1)) {
    return "특수 상성으로 승부가 났습니다.";
  }
  return "강한 타일이 라운드를 이겼습니다.";
}

function getPlayerName(players: PlayerSnapshot[], playerId: string | null) {
  if (!playerId) {
    return "승자 없음";
  }
  return players.find((player) => player.id === playerId)?.name ?? "플레이어";
}

function finishStatus(state: GuryongtuState, roundNumber: number) {
  const [firstId, secondId] = state.playerIds;
  const firstScore = state.scores[firstId] ?? 0;
  const secondScore = state.scores[secondId] ?? 0;
  const remainingRounds = TILES.length - roundNumber;

  if (firstScore > secondScore + remainingRounds) {
    return { finished: true, winnerId: firstId };
  }
  if (secondScore > firstScore + remainingRounds) {
    return { finished: true, winnerId: secondId };
  }
  if (roundNumber >= TILES.length) {
    return {
      finished: true,
      winnerId: firstScore === secondScore ? null : firstScore > secondScore ? firstId : secondId
    };
  }

  return { finished: false, winnerId: null };
}

function createState(context: Pick<GameContext, "players">): GuryongtuState {
  const playerIds = orderedPlayers(context.players, 2);
  const firstAttackerId = playerIds.length > 0 ? playerIds[Math.floor(Math.random() * playerIds.length)] : null;

  return {
    playerIds,
    activePlayerId: firstAttackerId,
    attackerId: firstAttackerId,
    phase: "selecting",
    choices: makeRecord(playerIds, () => null),
    usedTiles: makeRecord(playerIds, () => [] as Tile[]),
    scores: makeRecord(playerIds, () => 0),
    rounds: [],
    winnerId: null
  };
}

function publicStateFrom(state: GuryongtuState, viewerId: string | null): GuryongtuPublicState {
  const pendingChoices: Record<string, PublicChoice> = {};
  const remainingTiles: Record<string, Tile[]> = {};
  const usedTiles: Record<string, Tile[]> = {};
  const playedStacks: Record<string, PublicPlayedTile[]> = {};
  const revealAll = state.phase === "complete";

  for (const playerId of state.playerIds) {
    const selectedTile = state.choices[playerId] ?? null;
    const canSeePlayerTiles = revealAll || viewerId === playerId;
    pendingChoices[playerId] = {
      selected: selectedTile !== null,
      tile: canSeePlayerTiles ? selectedTile : null,
      color: selectedTile !== null ? tileColor(selectedTile) : null
    };
    usedTiles[playerId] = canSeePlayerTiles ? state.usedTiles[playerId] ?? [] : [];
    remainingTiles[playerId] = canSeePlayerTiles ? TILES.filter((tile) => !(state.usedTiles[playerId] ?? []).includes(tile)) : [];
    playedStacks[playerId] = (state.usedTiles[playerId] ?? []).map((tile) => ({
      color: tileColor(tile),
      tile: canSeePlayerTiles ? tile : null
    }));
  }

  return {
    playerIds: state.playerIds,
    activePlayerId: state.activePlayerId,
    attackerId: state.attackerId,
    phase: state.phase,
    pendingChoices,
    usedTiles,
    remainingTiles,
    playedStacks,
    scores: state.scores,
    rounds: state.rounds.map((round) => ({
      roundNumber: round.roundNumber,
      attackerId: round.attackerId,
      plays: Object.fromEntries(
        state.playerIds.map((playerId) => {
          const tile = round.tiles[playerId];
          return [
            playerId,
            {
              color: tileColor(tile),
              tile: revealAll || viewerId === playerId ? tile : null
            }
          ];
        })
      ) as Record<string, PublicPlayedTile>,
      winnerId: round.winnerId,
      reason: publicRoundReason(round)
    })),
    winnerId: state.winnerId
  };
}

export const module: GameModule = {
  id: "guryongtu",
  createInitialState: createState,
  getPublicState: (state, context) => publicStateFrom(state as GuryongtuState, context.viewerId),
  applyAction: (state, action, context) => {
    const current = state as GuryongtuState;

    if (action.type !== "guryongtu/select-tile") {
      return { state: current, message: "지원하지 않는 구룡투 행동입니다." };
    }

    if (current.phase === "complete") {
      return { state: current, activePlayerId: null, message: "이미 끝난 대결입니다." };
    }

    const playerId = context.currentPlayerId;
    if (!current.playerIds.includes(playerId)) {
      return { state: current, message: "대결에 참여한 플레이어만 타일을 고를 수 있습니다." };
    }
    if (current.activePlayerId !== playerId) {
      return {
        state: current,
        activePlayerId: current.activePlayerId,
        message: `${getPlayerName(context.players, current.activePlayerId)}님 차례입니다. 선공이 먼저 내고 후공이 응수합니다.`
      };
    }
    const tile = readTile(action);
    if (tile === null) {
      return { state: current, activePlayerId: current.activePlayerId, message: "1부터 9 사이의 타일을 골라주세요." };
    }
    if ((current.usedTiles[playerId] ?? []).includes(tile)) {
      return { state: current, activePlayerId: current.activePlayerId, message: "이미 사용한 타일입니다." };
    }
    if (current.choices[playerId] !== null) {
      return { state: current, activePlayerId: current.activePlayerId, message: "이번 라운드에서는 이미 선택했습니다." };
    }

    const choices = { ...current.choices, [playerId]: tile };
    const waitingPlayerId = current.playerIds.find((id) => choices[id] === null) ?? null;

    if (waitingPlayerId) {
      const nextState: GuryongtuState = {
        ...current,
        choices,
        activePlayerId: waitingPlayerId
      };

      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} 선공 타일 제출`,
        activePlayerId: waitingPlayerId,
        turnNumber: context.turnNumber + 1,
        phase: nextState.phase,
        message: `${getPlayerName(context.players, waitingPlayerId)}님이 색상을 보고 응수할 차례입니다.`
      };
    }

    const [firstId, secondId] = current.playerIds;
    const firstTile = choices[firstId] as Tile;
    const secondTile = choices[secondId] as Tile;
    const comparison = compareTiles(firstTile, secondTile);
    const roundWinnerId = comparison === 0 ? null : comparison > 0 ? firstId : secondId;
    const scores = { ...current.scores };
    if (roundWinnerId) {
      scores[roundWinnerId] = (scores[roundWinnerId] ?? 0) + 1;
    }

    const usedTiles = {
      ...current.usedTiles,
      [firstId]: [...(current.usedTiles[firstId] ?? []), firstTile],
      [secondId]: [...(current.usedTiles[secondId] ?? []), secondTile]
    };
    const roundNumber = current.rounds.length + 1;
    const revealedRound: RevealedRound = {
      roundNumber,
      attackerId: current.attackerId,
      tiles: { [firstId]: firstTile, [secondId]: secondTile },
      winnerId: roundWinnerId,
      reason: roundReason(firstTile, secondTile, comparison)
    };

    const provisionalState: GuryongtuState = {
      ...current,
      choices: makeRecord(current.playerIds, () => null),
      usedTiles,
      scores,
      rounds: [...current.rounds, revealedRound]
    };
    const completion = finishStatus(provisionalState, roundNumber);
    const nextAttackerId = completion.finished ? null : roundWinnerId ?? current.attackerId;
    const activePlayerId = completion.finished ? null : nextAttackerId;
    const nextState: GuryongtuState = {
      ...provisionalState,
      phase: completion.finished ? "complete" : "selecting",
      activePlayerId,
      attackerId: nextAttackerId,
      winnerId: completion.finished ? completion.winnerId : null
    };

    const winnerName = roundWinnerId ? getPlayerName(context.players, roundWinnerId) : "승자 없음";

    return {
      state: nextState,
      log: `${roundNumber}라운드 공개 완료. ${roundWinnerId ? `${winnerName} 승리` : "무승부"}`,
      activePlayerId,
      turnNumber: context.turnNumber + 1,
      roundNumber: completion.finished ? roundNumber : roundNumber + 1,
      phase: nextState.phase,
      winnerId: nextState.winnerId
    };
  }
};

export function Component({
  players,
  currentPlayer,
  publicState,
  disabled,
  onAction
}: GameComponentProps<GuryongtuPublicState>) {
  const state = publicState;
  const myId = currentPlayer?.id ?? null;
  const canChoose = Boolean(
    myId &&
      state.phase === "selecting" &&
      state.playerIds.includes(myId) &&
      state.activePlayerId === myId &&
      state.pendingChoices[myId]?.selected !== true
  );
  const myUsedTiles = myId ? state.usedTiles[myId] ?? [] : [];
  const myPendingTile = myId ? state.pendingChoices[myId]?.tile ?? null : null;
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [state.activePlayerId, state.phase, myPendingTile, state.rounds.length],
    { cooldownMs: 640 }
  );
  const actionDisabled = disabled || !canChoose || isSubmitting;
  const activeName = getPlayerName(players, state.activePlayerId);
  const attackerName = getPlayerName(players, state.attackerId);
  const moduleClassName = `game-module guryongtu-module ${state.phase === "complete" ? "is-complete" : "is-selecting"} ${isSubmitting ? "is-submitting" : ""}`;

  return (
    <section className={moduleClassName} style={styles.shell} aria-label="Guryongtu board">
      <div className="guryongtu-status" style={styles.statusGrid}>
        {state.playerIds.map((playerId) => {
          const player = players.find((candidate) => candidate.id === playerId);
          const pending = state.pendingChoices[playerId];
          const score = state.scores[playerId] ?? 0;
          const stack = state.playedStacks[playerId] ?? [];
          const pendingStack =
            state.phase === "selecting" && pending?.selected && pending.color
              ? [{ color: pending.color, tile: pending.tile, pending: true }]
              : [];
          const visibleStack = [...stack, ...pendingStack];
          const isMine = playerId === myId;
          const pendingLabel = pending?.selected
            ? pending.tile
              ? `내 선택: ${tileColorLabel(pending.color)} ${pending.tile}`
              : pending.color
                ? `${tileColorLabel(pending.color)} 타일 제출`
                : "선택 완료"
            : "선택 중";

          return (
            <article className="guryongtu-player-panel" style={styles.panel} key={playerId}>
              <h3>{player?.name ?? "플레이어"}</h3>
              <p>승수: {score}</p>
              <p>{pendingLabel}</p>
              <div className="guryongtu-play-stack" aria-label={`${player?.name ?? "플레이어"} 제출 타일 스택`}>
                {visibleStack.length === 0 ? <span className="guryongtu-stack-empty">아직 없음</span> : null}
                {visibleStack.map((play, index) => (
                  <span
                    className={`guryongtu-stack-token ${play.color} ${play.tile ? "known" : "hidden"} ${"pending" in play && play.pending ? "pending" : state.rounds[index]?.winnerId === playerId ? "won" : state.rounds[index]?.winnerId === null ? "tied" : "lost"}`}
                    key={`${playerId}-${index}-${play.color}-${"pending" in play && play.pending ? "pending" : "played"}`}
                    title={
                      "pending" in play && play.pending
                        ? play.tile
                          ? `이번 라운드 내 선택 ${play.tile}`
                          : `이번 라운드 ${tileColorLabel(play.color)} 타일 제출`
                        : play.tile
                          ? `${index + 1}라운드 ${play.tile}`
                          : `${index + 1}라운드 ${tileColorLabel(play.color)} 타일`
                    }
                    style={{ "--reveal-index": index } as CSSProperties}
                  >
                    <small>{"pending" in play && play.pending ? "now" : index + 1}</small>
                    <strong>{play.tile ?? tileColorLabel(play.color)}</strong>
                  </span>
                ))}
              </div>
              {!isMine ? (
                <p className="guryongtu-hidden-note">
                  {state.phase === "complete" ? "종료 공개 · 숫자 비교 가능" : "상대 숫자는 비공개 · 색상만 기록"}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="guryongtu-coin-strip" aria-label="선공 결정">
        <span className="guryongtu-coin" aria-hidden="true">
          先
        </span>
        <div>
          <strong>{state.phase === "complete" ? "대결 종료" : `동전 던지기 결과 · ${attackerName} 선공`}</strong>
          <small>
            {state.phase === "complete"
              ? "상대 스택이 공개되어 라운드별 비교가 가능합니다."
              : `${activeName} 차례입니다. 선공이 먼저 내고 후공이 색상을 보고 응수합니다.`}
          </small>
        </div>
      </div>

      <div className="guryongtu-choice-panel" style={styles.panel}>
        <div className="guryongtu-turn-meta" style={styles.meta}>
          <strong>{state.phase === "complete" ? "대결 종료" : `${activeName} 차례 · 순차 비공개 선택`}</strong>
          {myPendingTile ? <span>내가 고른 타일: {myPendingTile}</span> : null}
        </div>

        <div className="guryongtu-tile-grid" style={styles.tileGrid}>
          {TILES.map((tile) => {
            const used = myUsedTiles.includes(tile);
            return (
              <button
                className={`guryongtu-tile-button ${tileColor(tile)} ${used ? "used" : ""}`}
                style={styles.tileButton}
                type="button"
                key={tile}
                disabled={actionDisabled || used}
                aria-pressed={myPendingTile === tile}
                onClick={() => submitAction({ type: "guryongtu/select-tile", payload: { tile } })}
              >
                {tile}
              </button>
            );
          })}
        </div>
      </div>

      {state.phase === "complete" ? (
        <div className="guryongtu-result-strip" aria-label="구룡투 결과">
          <strong>결과</strong>
          <span>{state.winnerId ? `${getPlayerName(players, state.winnerId)} 승리` : "무승부"}</span>
        </div>
      ) : null}
    </section>
  );
}
