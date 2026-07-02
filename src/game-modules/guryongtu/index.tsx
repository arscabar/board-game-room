import type { CSSProperties } from "react";
import type { GameAction, GameComponentProps, GameContext, GameModule } from "../types";
import type { PlayerSnapshot } from "../../shared/types";

const TILES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

type Tile = (typeof TILES)[number];

interface RevealedRound {
  roundNumber: number;
  tiles: Record<string, Tile>;
  winnerId: string | null;
  reason: string;
}

interface GuryongtuState {
  playerIds: string[];
  activePlayerId: string | null;
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
}

interface GuryongtuPublicState {
  playerIds: string[];
  activePlayerId: string | null;
  phase: "selecting" | "complete";
  pendingChoices: Record<string, PublicChoice>;
  usedTiles: Record<string, Tile[]>;
  remainingTiles: Record<string, Tile[]>;
  scores: Record<string, number>;
  rounds: RevealedRound[];
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
  history: {
    display: "grid",
    gap: "0.45rem"
  }
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

  return {
    playerIds,
    activePlayerId: playerIds[0] ?? null,
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

  for (const playerId of state.playerIds) {
    const selectedTile = state.choices[playerId] ?? null;
    pendingChoices[playerId] = {
      selected: selectedTile !== null,
      tile: viewerId === playerId ? selectedTile : null
    };
    remainingTiles[playerId] = TILES.filter((tile) => !(state.usedTiles[playerId] ?? []).includes(tile));
  }

  return {
    playerIds: state.playerIds,
    activePlayerId: state.activePlayerId,
    phase: state.phase,
    pendingChoices,
    usedTiles: state.usedTiles,
    remainingTiles,
    scores: state.scores,
    rounds: state.rounds,
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
      const activePlayerId = choices[current.activePlayerId ?? ""] === null ? current.activePlayerId : waitingPlayerId;
      const nextState: GuryongtuState = {
        ...current,
        choices,
        activePlayerId
      };

      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} 타일 선택 완료`,
        activePlayerId,
        turnNumber: context.turnNumber + 1,
        phase: nextState.phase,
        message: "상대의 비공개 선택을 기다리는 중입니다."
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
    const activePlayerId = completion.finished ? null : roundWinnerId ?? current.activePlayerId;
    const nextState: GuryongtuState = {
      ...provisionalState,
      phase: completion.finished ? "complete" : "selecting",
      activePlayerId,
      winnerId: completion.finished ? completion.winnerId : null
    };

    const winnerName = roundWinnerId ? getPlayerName(context.players, roundWinnerId) : "승자 없음";

    return {
      state: nextState,
      log: `${roundNumber}라운드: ${firstTile} 대 ${secondTile}. ${winnerName} 승리`,
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
      state.pendingChoices[myId]?.selected !== true
  );
  const myUsedTiles = myId ? state.usedTiles[myId] ?? [] : [];
  const myPendingTile = myId ? state.pendingChoices[myId]?.tile ?? null : null;
  const actionDisabled = disabled || !canChoose;
  const activeName = getPlayerName(players, state.activePlayerId);

  return (
    <section className="game-module guryongtu-module" style={styles.shell} aria-label="Guryongtu board">
      <div className="guryongtu-status" style={styles.statusGrid}>
        {state.playerIds.map((playerId) => {
          const player = players.find((candidate) => candidate.id === playerId);
          const pending = state.pendingChoices[playerId];
          const score = state.scores[playerId] ?? 0;

          return (
            <article className="guryongtu-player-panel" style={styles.panel} key={playerId}>
              <h3>{player?.name ?? "플레이어"}</h3>
              <p>승수: {score}</p>
              <p>{pending?.selected ? (pending.tile ? `내 선택: ${pending.tile}` : "선택 완료") : "선택 중"}</p>
              <p>사용: {(state.usedTiles[playerId] ?? []).join(", ") || "없음"}</p>
            </article>
          );
        })}
      </div>

      <div className="guryongtu-choice-panel" style={styles.panel}>
        <div className="guryongtu-turn-meta" style={styles.meta}>
          <strong>{state.phase === "complete" ? "대결 종료" : `${activeName} 대기 기준 · 각자 비공개 선택`}</strong>
          {myPendingTile ? <span>내가 고른 타일: {myPendingTile}</span> : null}
        </div>

        <div className="guryongtu-tile-grid" style={styles.tileGrid}>
          {TILES.map((tile) => {
            const used = myUsedTiles.includes(tile);
            return (
              <button
                className="guryongtu-tile-button"
                style={styles.tileButton}
                type="button"
                key={tile}
                disabled={actionDisabled || used}
                aria-pressed={myPendingTile === tile}
                onClick={() => onAction({ type: "guryongtu/select-tile", payload: { tile } })}
              >
                {tile}
              </button>
            );
          })}
        </div>
      </div>

      <div className="guryongtu-history" style={styles.panel}>
        <h3>공개 기록</h3>
        <div style={styles.history}>
          {state.rounds.length === 0 ? <p>아직 공개된 타일이 없습니다.</p> : null}
          {state.rounds.map((round) => (
            <div className="guryongtu-round-row" key={round.roundNumber}>
              <strong>{round.roundNumber}라운드</strong>{" "}
              {state.playerIds.map((playerId) => `${getPlayerName(players, playerId)}: ${round.tiles[playerId]}`).join(" / ")}
              {" - "}
              {round.winnerId ? `${getPlayerName(players, round.winnerId)} 승리` : "무승부"}
            </div>
          ))}
        </div>
        {state.phase === "complete" ? (
          <p>
            승자: {state.winnerId ? getPlayerName(players, state.winnerId) : "무승부"}
          </p>
        ) : null}
      </div>
    </section>
  );
}
