import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { GameAction, GameComponentProps, GameContext, GameModule } from "../types";
import type { PlayerSnapshot } from "../../shared/types";

const MAX_WORD_LENGTH = 8;
const MAX_MISSES = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface HangmanProgress {
  targetId: string;
  revealed: boolean[];
  guessedLetters: string[];
  missedLetters: string[];
  wholeWordGuesses: string[];
  misses: number;
}

interface HangmanState {
  playerIds: string[];
  activePlayerId: string | null;
  phase: "setup" | "guessing" | "complete";
  secrets: Record<string, string | null>;
  progress: Record<string, HangmanProgress>;
  wins: Record<string, number>;
  roundNumber: number;
  winnerId: string | null;
  lastGuess: {
    playerId: string;
    targetId: string;
    guess: string;
    kind: "letter" | "word";
    hit: boolean;
  } | null;
}

interface PublicProgress {
  targetId: string;
  guessedLetters: string[];
  missedLetters: string[];
  wholeWordGuesses: string[];
  misses: number;
  solved: boolean;
}

interface HangmanPublicState {
  playerIds: string[];
  activePlayerId: string | null;
  phase: "setup" | "guessing" | "complete";
  setup: {
    submitted: Record<string, boolean>;
    wordLengths: Record<string, number>;
    ownSecret: string | null;
  };
  displays: Record<string, string[]>;
  progress: Record<string, PublicProgress>;
  wins: Record<string, number>;
  roundNumber: number;
  maxMisses: number;
  winnerId: string | null;
  lastGuess: HangmanState["lastGuess"];
}

const styles: Record<string, CSSProperties> = {
  shell: {
    display: "grid",
    gap: "1rem",
    width: "100%"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "0.75rem"
  },
  panel: {
    border: "1px solid rgba(157, 63, 71, 0.25)",
    borderRadius: 8,
    padding: "0.85rem",
    background: "rgba(255, 255, 255, 0.78)"
  },
  form: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    alignItems: "end"
  },
  inputGroup: {
    display: "grid",
    gap: "0.25rem",
    minWidth: "12rem",
    flex: "1 1 12rem"
  },
  wordDisplay: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.35rem",
    margin: "0.5rem 0"
  },
  letterSlot: {
    width: "2rem",
    minHeight: "2.25rem",
    display: "grid",
    placeItems: "center",
    borderBottom: "2px solid rgba(15, 23, 42, 0.55)",
    fontWeight: 800
  },
  alphabet: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(2.3rem, 1fr))",
    gap: "0.35rem"
  },
  letterButton: {
    minHeight: "2.35rem",
    borderRadius: 8,
    border: "1px solid rgba(15, 23, 42, 0.22)",
    fontWeight: 700
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    alignItems: "center"
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

function getPlayerName(players: PlayerSnapshot[], playerId: string | null) {
  if (!playerId) {
    return "No player";
  }
  return players.find((player) => player.id === playerId)?.name ?? "Player";
}

function normalizeWord(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const word = value.trim().toUpperCase();
  return /^[A-Z]{1,8}$/.test(word) ? word : null;
}

function readWord(action: GameAction) {
  const raw =
    typeof action.payload === "object" && action.payload !== null && "word" in action.payload
      ? (action.payload as { word?: unknown }).word
      : action.payload;
  return normalizeWord(raw);
}

function readLetter(action: GameAction) {
  const raw =
    typeof action.payload === "object" && action.payload !== null && "letter" in action.payload
      ? (action.payload as { letter?: unknown }).letter
      : action.payload;

  if (typeof raw !== "string") {
    return null;
  }

  const letter = raw.trim().toUpperCase();
  return /^[A-Z]$/.test(letter) ? letter : null;
}

function otherPlayer(playerIds: string[], playerId: string) {
  return playerIds.find((candidate) => candidate !== playerId) ?? null;
}

function initializeProgress(playerIds: string[], secrets: Record<string, string | null>) {
  const progress: Record<string, HangmanProgress> = {};
  for (const playerId of playerIds) {
    const targetId = otherPlayer(playerIds, playerId);
    const targetSecret = targetId ? secrets[targetId] ?? "" : "";
    progress[playerId] = {
      targetId: targetId ?? "",
      revealed: Array.from({ length: targetSecret.length }, () => false),
      guessedLetters: [],
      missedLetters: [],
      wholeWordGuesses: [],
      misses: 0
    };
  }
  return progress;
}

function createState(context: Pick<GameContext, "players">): HangmanState {
  const playerIds = orderedPlayers(context.players, 2);

  return {
    playerIds,
    activePlayerId: null,
    phase: "setup",
    secrets: makeRecord(playerIds, () => null),
    progress: {},
    wins: makeRecord(playerIds, () => 0),
    roundNumber: 1,
    winnerId: null,
    lastGuess: null
  };
}

function visibleDisplayFor(targetId: string, state: HangmanState, viewerId: string | null) {
  const secret = state.secrets[targetId] ?? "";
  if (viewerId === targetId) {
    return secret.split("");
  }

  const viewerProgress = viewerId ? state.progress[viewerId] : undefined;
  if (viewerProgress?.targetId === targetId) {
    return secret.split("").map((letter, index) => (viewerProgress.revealed[index] ? letter : "_"));
  }

  return Array.from({ length: secret.length }, () => "_");
}

function publicStateFrom(state: HangmanState, viewerId: string | null): HangmanPublicState {
  const submitted: Record<string, boolean> = {};
  const wordLengths: Record<string, number> = {};
  const displays: Record<string, string[]> = {};
  const progress: Record<string, PublicProgress> = {};

  for (const playerId of state.playerIds) {
    const secret = state.secrets[playerId];
    submitted[playerId] = Boolean(secret);
    wordLengths[playerId] = secret?.length ?? 0;
    displays[playerId] = visibleDisplayFor(playerId, state, viewerId);
  }

  for (const playerId of state.playerIds) {
    const playerProgress = state.progress[playerId];
    if (!playerProgress) {
      continue;
    }
    progress[playerId] = {
      targetId: playerProgress.targetId,
      guessedLetters: playerProgress.guessedLetters,
      missedLetters: playerProgress.missedLetters,
      wholeWordGuesses: playerProgress.wholeWordGuesses,
      misses: playerProgress.misses,
      solved: playerProgress.revealed.length > 0 && playerProgress.revealed.every(Boolean)
    };
  }

  return {
    playerIds: state.playerIds,
    activePlayerId: state.activePlayerId,
    phase: state.phase,
    setup: {
      submitted,
      wordLengths,
      ownSecret: viewerId ? state.secrets[viewerId] ?? null : null
    },
    displays,
    progress,
    wins: state.wins,
    roundNumber: state.roundNumber,
    maxMisses: MAX_MISSES,
    winnerId: state.winnerId,
    lastGuess: state.lastGuess
  };
}

function completeRound(state: HangmanState, winnerId: string, progress: Record<string, HangmanProgress>, lastGuess: HangmanState["lastGuess"]) {
  return {
    ...state,
    phase: "complete" as const,
    activePlayerId: null,
    progress,
    wins: {
      ...state.wins,
      [winnerId]: (state.wins[winnerId] ?? 0) + 1
    },
    winnerId,
    lastGuess
  };
}

export const module: GameModule = {
  id: "hangman-board-game",
  createInitialState: createState,
  getPublicState: (state, context) => publicStateFrom(state as HangmanState, context.viewerId),
  applyAction: (state, action, context) => {
    const current = state as HangmanState;
    const playerId = context.currentPlayerId;

    if (!current.playerIds.includes(playerId)) {
      return { state: current, activePlayerId: current.activePlayerId, message: "Only seated players can act." };
    }

    if (action.type === "hangman-board-game/setup-secret") {
      if (current.phase !== "setup") {
        return { state: current, activePlayerId: current.activePlayerId, message: "Secret words are already locked." };
      }

      const word = readWord(action);
      if (!word) {
        return { state: current, activePlayerId: current.activePlayerId, message: `Use 1 to ${MAX_WORD_LENGTH} letters only.` };
      }
      if (current.secrets[playerId]) {
        return { state: current, activePlayerId: current.activePlayerId, message: "Your secret word is already submitted." };
      }

      const secrets = { ...current.secrets, [playerId]: word };
      const ready = current.playerIds.every((id) => Boolean(secrets[id]));
      const progress = ready ? initializeProgress(current.playerIds, secrets) : current.progress;
      const activePlayerId = ready ? current.playerIds[0] ?? null : null;
      const nextState: HangmanState = {
        ...current,
        secrets,
        progress,
        phase: ready ? "guessing" : "setup",
        activePlayerId
      };

      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} submitted a secret word.`,
        activePlayerId,
        phase: nextState.phase,
        roundNumber: nextState.roundNumber
      };
    }

    if (current.phase !== "guessing") {
      return { state: current, activePlayerId: current.activePlayerId, message: "The round is not ready for guesses." };
    }
    if (current.activePlayerId !== playerId) {
      return { state: current, activePlayerId: current.activePlayerId, message: "Wait for your guessing turn." };
    }

    const playerProgress = current.progress[playerId];
    if (!playerProgress) {
      return { state: current, activePlayerId: current.activePlayerId, message: "No target word is ready." };
    }
    const targetSecret = current.secrets[playerProgress.targetId] ?? "";

    if (action.type === "hangman-board-game/guess-letter") {
      const letter = readLetter(action);
      if (!letter) {
        return { state: current, activePlayerId: current.activePlayerId, message: "Choose one letter." };
      }
      if (playerProgress.guessedLetters.includes(letter)) {
        return { state: current, activePlayerId: current.activePlayerId, message: "That letter was already guessed." };
      }

      const revealed = playerProgress.revealed.map((value, index) => value || targetSecret[index] === letter);
      const hit = revealed.some((value, index) => value && !playerProgress.revealed[index]);
      const nextPlayerProgress: HangmanProgress = {
        ...playerProgress,
        revealed,
        guessedLetters: [...playerProgress.guessedLetters, letter],
        missedLetters: hit ? playerProgress.missedLetters : [...playerProgress.missedLetters, letter],
        misses: hit ? playerProgress.misses : playerProgress.misses + 1
      };
      const progress = { ...current.progress, [playerId]: nextPlayerProgress };
      const lastGuess = {
        playerId,
        targetId: playerProgress.targetId,
        guess: letter,
        kind: "letter" as const,
        hit
      };

      if (revealed.every(Boolean)) {
        const nextState = completeRound(current, playerId, progress, lastGuess);
        return {
          state: nextState,
          log: `${getPlayerName(context.players, playerId)} solved the word.`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          phase: nextState.phase,
          winnerId: playerId
        };
      }
      if (nextPlayerProgress.misses >= MAX_MISSES) {
        const nextState = completeRound(current, playerProgress.targetId, progress, lastGuess);
        return {
          state: nextState,
          log: `${getPlayerName(context.players, playerId)} reached the miss limit.`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          phase: nextState.phase,
          winnerId: playerProgress.targetId
        };
      }

      const activePlayerId = playerProgress.targetId;
      const nextState: HangmanState = {
        ...current,
        activePlayerId,
        progress,
        lastGuess
      };

      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} guessed ${letter}.`,
        activePlayerId,
        turnNumber: context.turnNumber + 1,
        phase: nextState.phase
      };
    }

    if (action.type === "hangman-board-game/guess-word") {
      const word = readWord(action);
      if (!word) {
        return { state: current, activePlayerId: current.activePlayerId, message: `Use 1 to ${MAX_WORD_LENGTH} letters only.` };
      }
      if (playerProgress.wholeWordGuesses.includes(word)) {
        return { state: current, activePlayerId: current.activePlayerId, message: "That whole-word guess was already used." };
      }

      const hit = word === targetSecret;
      const nextPlayerProgress: HangmanProgress = {
        ...playerProgress,
        revealed: hit ? Array.from({ length: targetSecret.length }, () => true) : playerProgress.revealed,
        wholeWordGuesses: [...playerProgress.wholeWordGuesses, word],
        misses: hit ? playerProgress.misses : playerProgress.misses + 1
      };
      const progress = { ...current.progress, [playerId]: nextPlayerProgress };
      const lastGuess = {
        playerId,
        targetId: playerProgress.targetId,
        guess: word,
        kind: "word" as const,
        hit
      };

      if (hit) {
        const nextState = completeRound(current, playerId, progress, lastGuess);
        return {
          state: nextState,
          log: `${getPlayerName(context.players, playerId)} solved the whole word.`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          phase: nextState.phase,
          winnerId: playerId
        };
      }
      if (nextPlayerProgress.misses >= MAX_MISSES) {
        const nextState = completeRound(current, playerProgress.targetId, progress, lastGuess);
        return {
          state: nextState,
          log: `${getPlayerName(context.players, playerId)} reached the miss limit.`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          phase: nextState.phase,
          winnerId: playerProgress.targetId
        };
      }

      const activePlayerId = playerProgress.targetId;
      const nextState: HangmanState = {
        ...current,
        activePlayerId,
        progress,
        lastGuess
      };

      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} made a whole-word guess.`,
        activePlayerId,
        turnNumber: context.turnNumber + 1,
        phase: nextState.phase
      };
    }

    return { state: current, activePlayerId: current.activePlayerId, message: "Unsupported Hangman action." };
  }
};

function WordDisplay({ letters }: { letters: string[] }) {
  return (
    <div className="hangman-word-display" style={styles.wordDisplay} aria-label="Word display">
      {letters.map((letter, index) => (
        <span className="hangman-letter-slot" style={styles.letterSlot} key={`${letter}-${index}`}>
          {letter}
        </span>
      ))}
    </div>
  );
}

export function Component({
  players,
  currentPlayer,
  publicState,
  disabled,
  onAction
}: GameComponentProps<HangmanPublicState>) {
  const state = publicState;
  const [secretWord, setSecretWord] = useState("");
  const [wholeWord, setWholeWord] = useState("");
  const myId = currentPlayer?.id ?? null;
  const myProgress = myId ? state.progress[myId] : undefined;
  const isMyTurn = Boolean(myId && state.activePlayerId === myId && state.phase === "guessing");
  const canGuess = !disabled && isMyTurn;
  const guessedLetters = new Set(myProgress?.guessedLetters ?? []);

  function submitSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = normalizeWord(secretWord);
    if (!word) {
      return;
    }
    onAction({ type: "hangman-board-game/setup-secret", payload: { word } });
    setSecretWord("");
  }

  function submitWholeWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = normalizeWord(wholeWord);
    if (!word) {
      return;
    }
    onAction({ type: "hangman-board-game/guess-word", payload: { word } });
    setWholeWord("");
  }

  return (
    <section className="game-module hangman-module" style={styles.shell} aria-label="Hangman board game">
      {state.phase === "setup" ? (
        <article className="hangman-setup-panel" style={styles.panel}>
          <h3>Secret word setup</h3>
          <div className="hangman-setup-grid" style={styles.grid}>
            {state.playerIds.map((playerId) => (
              <div className="hangman-player-setup" key={playerId}>
                <strong>{getPlayerName(players, playerId)}</strong>
                <p>{state.setup.submitted[playerId] ? "Submitted" : "Waiting"}</p>
                {myId === playerId && state.setup.ownSecret ? <p>Your secret: {state.setup.ownSecret}</p> : null}
                {myId !== playerId && state.setup.wordLengths[playerId] > 0 ? <p>Opponent blanks: {state.setup.wordLengths[playerId]}</p> : null}
              </div>
            ))}
          </div>
          {myId && !state.setup.submitted[myId] ? (
            <form className="hangman-secret-form" style={styles.form} onSubmit={submitSecret}>
              <label style={styles.inputGroup}>
                Secret word
                <input
                  value={secretWord}
                  maxLength={MAX_WORD_LENGTH}
                  pattern="[A-Za-z]{1,8}"
                  autoCapitalize="characters"
                  onChange={(event) => setSecretWord(event.currentTarget.value)}
                />
              </label>
              <button type="submit" disabled={disabled || !normalizeWord(secretWord)}>
                Submit
              </button>
            </form>
          ) : null}
        </article>
      ) : null}

      {state.phase !== "setup" ? (
        <>
          <div className="hangman-board-grid" style={styles.grid}>
            {state.playerIds.map((playerId) => {
              const isOwnSecret = myId === playerId;
              return (
                <article className="hangman-word-panel" style={styles.panel} key={playerId}>
                  <h3>{getPlayerName(players, playerId)}</h3>
                  <p>{isOwnSecret ? "Your secret" : "Opponent word"}</p>
                  <WordDisplay letters={state.displays[playerId] ?? []} />
                  <p>Round wins: {state.wins[playerId] ?? 0}</p>
                </article>
              );
            })}
          </div>

          <article className="hangman-guess-panel" style={styles.panel}>
            <div className="hangman-turn-meta" style={styles.meta}>
              <strong>
                {state.phase === "complete" ? "Round complete" : `Guessing: ${getPlayerName(players, state.activePlayerId)}`}
              </strong>
              {myProgress ? (
                <span>
                  Misses: {myProgress.misses}/{state.maxMisses}
                </span>
              ) : null}
              {state.lastGuess ? (
                <span>
                  Last: {getPlayerName(players, state.lastGuess.playerId)} guessed {state.lastGuess.guess} (
                  {state.lastGuess.hit ? "hit" : "miss"})
                </span>
              ) : null}
            </div>

            <div className="hangman-alphabet" style={styles.alphabet}>
              {ALPHABET.map((letter) => (
                <button
                  className="hangman-letter-button"
                  style={styles.letterButton}
                  type="button"
                  key={letter}
                  disabled={!canGuess || guessedLetters.has(letter)}
                  onClick={() => onAction({ type: "hangman-board-game/guess-letter", payload: { letter } })}
                >
                  {letter}
                </button>
              ))}
            </div>

            <form className="hangman-word-guess-form" style={{ ...styles.form, marginTop: "0.75rem" }} onSubmit={submitWholeWord}>
              <label style={styles.inputGroup}>
                Whole-word guess
                <input
                  value={wholeWord}
                  maxLength={MAX_WORD_LENGTH}
                  pattern="[A-Za-z]{1,8}"
                  autoCapitalize="characters"
                  onChange={(event) => setWholeWord(event.currentTarget.value)}
                />
              </label>
              <button type="submit" disabled={!canGuess || !normalizeWord(wholeWord)}>
                Guess word
              </button>
            </form>

            {myProgress ? (
              <p>
                Missed letters: {myProgress.missedLetters.join(", ") || "None"} | Whole-word guesses:{" "}
                {myProgress.wholeWordGuesses.join(", ") || "None"}
              </p>
            ) : null}

            {state.phase === "complete" ? (
              <p>Winner: {state.winnerId ? getPlayerName(players, state.winnerId) : "No winner"}</p>
            ) : null}
          </article>
        </>
      ) : null}
    </section>
  );
}
