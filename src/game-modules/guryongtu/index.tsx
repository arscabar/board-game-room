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
    gridTemplateColumns: "repeat(9, minmax(2.25rem, 1fr))",
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
    return "Matched tiles tie the round.";
  }
  if ((firstTile === 1 && secondTile === 9) || (firstTile === 9 && secondTile === 1)) {
    return "The 1 beats 9 exception decides the round.";
  }
  return "The higher tile wins the round.";
}

function getPlayerName(players: PlayerSnapshot[], playerId: string | null) {
  if (!playerId) {
    return "No winner";
  }
  return players.find((player) => player.id === playerId)?.name ?? "Player";
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
      return { state: current, message: "Unsupported Guryongtu action." };
    }

    if (current.phase === "complete") {
      return { state: current, activePlayerId: null, message: "This duel is already complete." };
    }

    const playerId = context.currentPlayerId;
    if (!current.playerIds.includes(playerId)) {
      return { state: current, message: "Only seated duel players can choose a tile." };
    }
    if (current.activePlayerId !== playerId) {
      return { state: current, activePlayerId: current.activePlayerId, message: "Wait for your private choice turn." };
    }

    const tile = readTile(action);
    if (tile === null) {
      return { state: current, activePlayerId: current.activePlayerId, message: "Choose a tile from 1 to 9." };
    }
    if ((current.usedTiles[playerId] ?? []).includes(tile)) {
      return { state: current, activePlayerId: current.activePlayerId, message: "That tile has already been used." };
    }
    if (current.choices[playerId] !== null) {
      return { state: current, activePlayerId: current.activePlayerId, message: "You have already selected this round." };
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
        log: `${getPlayerName(context.players, playerId)} locked in a tile.`,
        activePlayerId: waitingPlayerId,
        turnNumber: context.turnNumber + 1,
        phase: nextState.phase
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
    const activePlayerId = completion.finished ? null : current.playerIds[roundNumber % current.playerIds.length];
    const nextState: GuryongtuState = {
      ...provisionalState,
      phase: completion.finished ? "complete" : "selecting",
      activePlayerId,
      winnerId: completion.finished ? completion.winnerId : null
    };

    const winnerName = roundWinnerId ? getPlayerName(context.players, roundWinnerId) : "No one";

    return {
      state: nextState,
      log: `Round ${roundNumber}: ${firstTile} vs ${secondTile}. ${winnerName} wins the reveal.`,
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
  const isMyTurn = Boolean(myId && state.phase === "selecting" && state.activePlayerId === myId);
  const myUsedTiles = myId ? state.usedTiles[myId] ?? [] : [];
  const myPendingTile = myId ? state.pendingChoices[myId]?.tile ?? null : null;
  const actionDisabled = disabled || !isMyTurn;
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
              <h3>{player?.name ?? "Player"}</h3>
              <p>Wins: {score}</p>
              <p>{pending?.selected ? (pending.tile ? `Locked: ${pending.tile}` : "Tile locked") : "Choosing"}</p>
              <p>Used: {(state.usedTiles[playerId] ?? []).join(", ") || "None"}</p>
            </article>
          );
        })}
      </div>

      <div className="guryongtu-choice-panel" style={styles.panel}>
        <div className="guryongtu-turn-meta" style={styles.meta}>
          <strong>{state.phase === "complete" ? "Duel complete" : `Choosing: ${activeName}`}</strong>
          {myPendingTile ? <span>Your pending tile: {myPendingTile}</span> : null}
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
        <h3>Reveals</h3>
        <div style={styles.history}>
          {state.rounds.length === 0 ? <p>No tiles have been revealed yet.</p> : null}
          {state.rounds.map((round) => (
            <div className="guryongtu-round-row" key={round.roundNumber}>
              <strong>Round {round.roundNumber}</strong>{" "}
              {state.playerIds.map((playerId) => `${getPlayerName(players, playerId)}: ${round.tiles[playerId]}`).join(" / ")}
              {" - "}
              {round.winnerId ? `${getPlayerName(players, round.winnerId)} wins` : "Tie"}
            </div>
          ))}
        </div>
        {state.phase === "complete" ? (
          <p>
            Winner: {state.winnerId ? getPlayerName(players, state.winnerId) : "Draw"}
          </p>
        ) : null}
      </div>
    </section>
  );
}

