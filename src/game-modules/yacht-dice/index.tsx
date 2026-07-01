import type { CSSProperties } from "react";
import type { GameAction, GameComponentProps, GameContext, GameModule } from "../types";
import type { PlayerSnapshot } from "../../shared/types";

const DICE_COUNT = 5;
const MAX_ROLLS = 3;

const CATEGORIES = [
  { id: "ones", label: "Ones", description: "Sum of 1s" },
  { id: "twos", label: "Twos", description: "Sum of 2s" },
  { id: "threes", label: "Threes", description: "Sum of 3s" },
  { id: "fours", label: "Fours", description: "Sum of 4s" },
  { id: "fives", label: "Fives", description: "Sum of 5s" },
  { id: "sixes", label: "Sixes", description: "Sum of 6s" },
  { id: "choice", label: "Choice", description: "Sum of all dice" },
  { id: "fourKind", label: "Four kind", description: "Sum if four dice match" },
  { id: "fullHouse", label: "Full house", description: "25 for a 3 plus 2 pattern" },
  { id: "smallStraight", label: "Small straight", description: "15 for four in sequence" },
  { id: "largeStraight", label: "Large straight", description: "30 for five in sequence" },
  { id: "yacht", label: "Yacht", description: "50 for five of a kind" }
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];
type DieValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type ScoreSheet = Partial<Record<CategoryId, number>>;

interface YachtState {
  playerIds: string[];
  activePlayerId: string | null;
  phase: "rolling" | "complete";
  dice: DieValue[];
  held: boolean[];
  rollsThisTurn: number;
  scores: Record<string, ScoreSheet>;
  winnerId: string | null;
  lastScored: {
    playerId: string;
    category: CategoryId;
    score: number;
  } | null;
}

interface YachtPublicState extends YachtState {
  totals: Record<string, number>;
}

const styles: Record<string, CSSProperties> = {
  shell: {
    display: "grid",
    gap: "1rem",
    width: "100%"
  },
  topGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "0.75rem"
  },
  panel: {
    border: "1px solid rgba(15, 118, 110, 0.22)",
    borderRadius: 8,
    padding: "0.85rem",
    background: "rgba(255, 255, 255, 0.78)"
  },
  diceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(3.25rem, 1fr))",
    gap: "0.45rem"
  },
  dieButton: {
    minHeight: "4rem",
    borderRadius: 8,
    border: "1px solid rgba(15, 23, 42, 0.22)",
    display: "grid",
    placeItems: "center",
    gap: "0.15rem",
    fontWeight: 700
  },
  actionRow: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
    alignItems: "center"
  },
  tableWrap: {
    overflowX: "auto"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse"
  },
  cell: {
    borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
    padding: "0.45rem",
    textAlign: "left"
  }
};

function orderedPlayers(players: PlayerSnapshot[], count: number) {
  return [...players]
    .sort((a, b) => a.seat - b.seat || a.joinedAt - b.joinedAt)
    .slice(0, count)
    .map((player) => player.id);
}

function getPlayerName(players: PlayerSnapshot[], playerId: string | null) {
  if (!playerId) {
    return "No player";
  }
  return players.find((player) => player.id === playerId)?.name ?? "Player";
}

function rollDie(): DieValue {
  return (Math.floor(Math.random() * 6) + 1) as DieValue;
}

function emptyDice() {
  return Array.from({ length: DICE_COUNT }, () => 0 as DieValue);
}

function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && CATEGORIES.some((category) => category.id === value);
}

function readCategory(action: GameAction) {
  const raw =
    typeof action.payload === "object" && action.payload !== null && "category" in action.payload
      ? (action.payload as { category?: unknown }).category
      : action.payload;
  return isCategoryId(raw) ? raw : null;
}

function readDieIndex(action: GameAction) {
  const raw =
    typeof action.payload === "object" && action.payload !== null && "index" in action.payload
      ? (action.payload as { index?: unknown }).index
      : action.payload;

  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw >= DICE_COUNT) {
    return null;
  }

  return raw;
}

function countsFor(dice: DieValue[]) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const die of dice) {
    counts[die] += 1;
  }
  return counts;
}

function hasStraight(dice: DieValue[], length: number) {
  const unique = new Set(dice.filter((die) => die > 0));
  const starts = length === 5 ? [1, 2] : [1, 2, 3];
  return starts.some((start) => Array.from({ length }, (_, index) => start + index).every((value) => unique.has(value as DieValue)));
}

function scoreCategory(category: CategoryId, dice: DieValue[]) {
  const counts = countsFor(dice);
  const sum = dice.reduce((total: number, die) => total + die, 0);

  switch (category) {
    case "ones":
      return counts[1] * 1;
    case "twos":
      return counts[2] * 2;
    case "threes":
      return counts[3] * 3;
    case "fours":
      return counts[4] * 4;
    case "fives":
      return counts[5] * 5;
    case "sixes":
      return counts[6] * 6;
    case "choice":
      return sum;
    case "fourKind":
      return counts.some((count) => count >= 4) ? sum : 0;
    case "fullHouse": {
      const sortedCounts = counts.filter((count) => count > 0).sort((a, b) => a - b);
      return (sortedCounts.length === 2 && sortedCounts[0] === 2 && sortedCounts[1] === 3) || sortedCounts[0] === 5 ? 25 : 0;
    }
    case "smallStraight":
      return hasStraight(dice, 4) ? 15 : 0;
    case "largeStraight":
      return hasStraight(dice, 5) ? 30 : 0;
    case "yacht":
      return counts.some((count) => count === 5) ? 50 : 0;
  }
}

function totalScore(scores: ScoreSheet) {
  return CATEGORIES.reduce((total, category) => total + (scores[category.id] ?? 0), 0);
}

function allCategoriesUsed(scores: ScoreSheet) {
  return CATEGORIES.every((category) => scores[category.id] !== undefined);
}

function nextPlayerAfter(state: YachtState, scores: Record<string, ScoreSheet>, playerId: string) {
  const currentIndex = Math.max(0, state.playerIds.indexOf(playerId));
  for (let offset = 1; offset <= state.playerIds.length; offset += 1) {
    const candidate = state.playerIds[(currentIndex + offset) % state.playerIds.length];
    if (!allCategoriesUsed(scores[candidate] ?? {})) {
      return candidate;
    }
  }
  return null;
}

function winnerFor(state: YachtState, scores: Record<string, ScoreSheet>) {
  let bestScore = -1;
  let bestPlayerIds: string[] = [];

  for (const playerId of state.playerIds) {
    const score = totalScore(scores[playerId] ?? {});
    if (score > bestScore) {
      bestScore = score;
      bestPlayerIds = [playerId];
    } else if (score === bestScore) {
      bestPlayerIds.push(playerId);
    }
  }

  return bestPlayerIds.length === 1 ? bestPlayerIds[0] : null;
}

function createState(context: Pick<GameContext, "players">): YachtState {
  const playerIds = orderedPlayers(context.players, 4);
  const scores: Record<string, ScoreSheet> = {};
  for (const playerId of playerIds) {
    scores[playerId] = {};
  }

  return {
    playerIds,
    activePlayerId: playerIds[0] ?? null,
    phase: "rolling",
    dice: emptyDice(),
    held: Array.from({ length: DICE_COUNT }, () => false),
    rollsThisTurn: 0,
    scores,
    winnerId: null,
    lastScored: null
  };
}

function publicStateFrom(state: YachtState): YachtPublicState {
  const totals: Record<string, number> = {};
  for (const playerId of state.playerIds) {
    totals[playerId] = totalScore(state.scores[playerId] ?? {});
  }

  return { ...state, totals };
}

export const module: GameModule = {
  id: "yacht-dice",
  createInitialState: createState,
  getPublicState: (state) => publicStateFrom(state as YachtState),
  applyAction: (state, action, context) => {
    const current = state as YachtState;

    if (current.phase === "complete") {
      return { state: current, activePlayerId: null, message: "The score sheet is complete." };
    }

    const playerId = context.currentPlayerId;
    if (current.activePlayerId !== playerId) {
      return { state: current, activePlayerId: current.activePlayerId, message: "Wait for your dice turn." };
    }

    if (action.type === "yacht-dice/roll") {
      if (current.rollsThisTurn >= MAX_ROLLS) {
        return { state: current, activePlayerId: current.activePlayerId, message: "You have used all three rolls." };
      }

      const dice = current.dice.map((die, index) => (current.held[index] && die > 0 ? die : rollDie()));
      const nextState: YachtState = {
        ...current,
        dice,
        rollsThisTurn: current.rollsThisTurn + 1
      };

      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} rolled the dice.`,
        activePlayerId: nextState.activePlayerId,
        phase: nextState.phase
      };
    }

    if (action.type === "yacht-dice/toggle-hold") {
      if (current.rollsThisTurn === 0) {
        return { state: current, activePlayerId: current.activePlayerId, message: "Roll before holding dice." };
      }

      const index = readDieIndex(action);
      if (index === null) {
        return { state: current, activePlayerId: current.activePlayerId, message: "Choose a valid die to hold." };
      }

      const held = current.held.map((value, heldIndex) => (heldIndex === index ? !value : value));
      const nextState: YachtState = { ...current, held };

      return {
        state: nextState,
        activePlayerId: nextState.activePlayerId,
        phase: nextState.phase
      };
    }

    if (action.type === "yacht-dice/score-category") {
      if (current.rollsThisTurn === 0) {
        return { state: current, activePlayerId: current.activePlayerId, message: "Roll before scoring." };
      }

      const category = readCategory(action);
      if (!category) {
        return { state: current, activePlayerId: current.activePlayerId, message: "Choose a valid score category." };
      }

      const playerScores = current.scores[playerId] ?? {};
      if (playerScores[category] !== undefined) {
        return { state: current, activePlayerId: current.activePlayerId, message: "That category is already scored." };
      }

      const score = scoreCategory(category, current.dice);
      const scores = {
        ...current.scores,
        [playerId]: {
          ...playerScores,
          [category]: score
        }
      };
      const gameComplete = current.playerIds.every((id) => allCategoriesUsed(scores[id] ?? {}));
      const activePlayerId = gameComplete ? null : nextPlayerAfter(current, scores, playerId);
      const nextState: YachtState = {
        ...current,
        activePlayerId,
        phase: gameComplete ? "complete" : "rolling",
        dice: gameComplete ? current.dice : emptyDice(),
        held: Array.from({ length: DICE_COUNT }, () => false),
        rollsThisTurn: 0,
        scores,
        winnerId: gameComplete ? winnerFor(current, scores) : null,
        lastScored: { playerId, category, score }
      };
      const categoryLabel = CATEGORIES.find((item) => item.id === category)?.label ?? category;

      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} scored ${score} in ${categoryLabel}.`,
        activePlayerId,
        turnNumber: context.turnNumber + 1,
        phase: nextState.phase,
        winnerId: nextState.winnerId
      };
    }

    return { state: current, activePlayerId: current.activePlayerId, message: "Unsupported Yacht Dice action." };
  }
};

export function Component({
  players,
  currentPlayer,
  publicState,
  disabled,
  onAction
}: GameComponentProps<YachtPublicState>) {
  const state = publicState;
  const activePlayerId = state.activePlayerId;
  const activeScores = activePlayerId ? state.scores[activePlayerId] ?? {} : {};
  const isMyTurn = Boolean(currentPlayer?.id && currentPlayer.id === activePlayerId && state.phase === "rolling");
  const canAct = !disabled && isMyTurn;
  const rollsLeft = MAX_ROLLS - state.rollsThisTurn;

  return (
    <section className="game-module yacht-dice-module" style={styles.shell} aria-label="Yacht Dice board">
      <div className="yacht-top-grid" style={styles.topGrid}>
        <article className="yacht-dice-panel" style={styles.panel}>
          <h3>Dice</h3>
          <p>
            Turn: {state.phase === "complete" ? "Game complete" : getPlayerName(players, activePlayerId)} | Rolls left: {Math.max(0, rollsLeft)}
          </p>
          <div className="yacht-dice-grid" style={styles.diceGrid}>
            {state.dice.map((die, index) => (
              <button
                className="yacht-die-button"
                style={{
                  ...styles.dieButton,
                  background: state.held[index] ? "rgba(20, 184, 166, 0.16)" : "rgba(255, 255, 255, 0.9)"
                }}
                type="button"
                key={index}
                disabled={!canAct || state.rollsThisTurn === 0}
                aria-pressed={state.held[index]}
                aria-label={`Toggle hold for die ${index + 1}`}
                onClick={() => onAction({ type: "yacht-dice/toggle-hold", payload: { index } })}
              >
                <span>Die {index + 1}</span>
                <strong>{die || "-"}</strong>
                <span>{state.held[index] ? "Held" : "Free"}</span>
              </button>
            ))}
          </div>
          <div className="yacht-actions" style={{ ...styles.actionRow, marginTop: "0.75rem" }}>
            <button
              type="button"
              className="yacht-roll-button"
              disabled={!canAct || state.rollsThisTurn >= MAX_ROLLS}
              onClick={() => onAction({ type: "yacht-dice/roll" })}
            >
              {state.rollsThisTurn === 0 ? "Roll dice" : "Roll again"}
            </button>
            {state.lastScored ? (
              <span>
                Last score: {getPlayerName(players, state.lastScored.playerId)} +{state.lastScored.score}
              </span>
            ) : null}
          </div>
        </article>

        <article className="yacht-score-panel" style={styles.panel}>
          <h3>Score this turn</h3>
          <div style={styles.tableWrap}>
            <table className="yacht-score-table" style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.cell}>Category</th>
                  <th style={styles.cell}>Preview</th>
                  <th style={styles.cell}>Score</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((category) => {
                  const usedScore = activeScores[category.id];
                  const preview = state.rollsThisTurn > 0 ? scoreCategory(category.id, state.dice) : 0;
                  return (
                    <tr key={category.id}>
                      <td style={styles.cell}>
                        <strong>{category.label}</strong>
                        <br />
                        <span>{category.description}</span>
                      </td>
                      <td style={styles.cell}>{usedScore ?? preview}</td>
                      <td style={styles.cell}>
                        {usedScore !== undefined ? (
                          <span>{usedScore}</span>
                        ) : (
                          <button
                            type="button"
                            className="yacht-score-button"
                            disabled={!canAct || state.rollsThisTurn === 0}
                            onClick={() => onAction({ type: "yacht-dice/score-category", payload: { category: category.id } })}
                          >
                            Take {preview}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article className="yacht-scoreboard" style={styles.panel}>
        <h3>Scoreboard</h3>
        <div style={styles.tableWrap}>
          <table className="yacht-player-table" style={styles.table}>
            <thead>
              <tr>
                <th style={styles.cell}>Player</th>
                <th style={styles.cell}>Total</th>
                {CATEGORIES.map((category) => (
                  <th style={styles.cell} key={category.id}>
                    {category.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.playerIds.map((playerId) => (
                <tr key={playerId}>
                  <td style={styles.cell}>{getPlayerName(players, playerId)}</td>
                  <td style={styles.cell}>{state.totals[playerId] ?? 0}</td>
                  {CATEGORIES.map((category) => (
                    <td style={styles.cell} key={category.id}>
                      {state.scores[playerId]?.[category.id] ?? "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {state.phase === "complete" ? (
          <p>Winner: {state.winnerId ? getPlayerName(players, state.winnerId) : "Tie"}</p>
        ) : null}
      </article>
    </section>
  );
}
