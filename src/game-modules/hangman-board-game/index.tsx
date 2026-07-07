import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { GameAction, GameComponentProps, GameContext, GameModule } from "../types";
import type { PlayerSnapshot } from "../../shared/types";
import { useInteractionGate } from "../useInteractionGate";

const MAX_WORD_LENGTH = 8;
const MAX_MISSES = 6;
const TARGET_WINS = 3;
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
  phase: "setup" | "guessing" | "round-complete" | "complete";
  secrets: Record<string, string | null>;
  progress: Record<string, HangmanProgress>;
  wins: Record<string, number>;
  roundNumber: number;
  roundWinnerId: string | null;
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
  phase: "setup" | "guessing" | "round-complete" | "complete";
  setup: {
    submitted: Record<string, boolean>;
    wordLengths: Record<string, number>;
    ownSecret: string | null;
  };
  displays: Record<string, string[]>;
  progress: Record<string, PublicProgress>;
  wins: Record<string, number>;
  roundNumber: number;
  roundWinnerId: string | null;
  targetWins: number;
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
    gridTemplateColumns: "repeat(auto-fit, minmax(2.75rem, 1fr))",
    gap: "0.35rem"
  },
  letterButton: {
    minHeight: "2.75rem",
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

function getPlayerName(players: PlayerSnapshot[], playerId: string | null) {
  if (!playerId) {
    return "플레이어 없음";
  }
  return players.find((player) => player.id === playerId)?.name ?? "플레이어";
}

function normalizeWord(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const word = value.trim().toUpperCase();
  return /^[A-Z가-힣]{1,8}$/.test(word) ? word : null;
}

function normalizeLetter(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const letter = value.trim().toUpperCase();
  return /^[A-Z가-힣]$/.test(letter) ? letter : null;
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

  return normalizeLetter(raw);
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
    roundWinnerId: null,
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
    roundWinnerId: state.roundWinnerId,
    targetWins: TARGET_WINS,
    maxMisses: MAX_MISSES,
    winnerId: state.winnerId,
    lastGuess: state.lastGuess
  };
}

function completeRound(state: HangmanState, winnerId: string, progress: Record<string, HangmanProgress>, lastGuess: HangmanState["lastGuess"]) {
  const wins = {
    ...state.wins,
    [winnerId]: (state.wins[winnerId] ?? 0) + 1
  };
  const matchWinnerId = wins[winnerId] >= TARGET_WINS ? winnerId : null;

  return {
    ...state,
    phase: matchWinnerId ? ("complete" as const) : ("round-complete" as const),
    activePlayerId: null,
    progress,
    wins,
    roundWinnerId: winnerId,
    winnerId: matchWinnerId,
    lastGuess
  };
}

function nextRoundState(state: HangmanState): HangmanState {
  return {
    ...state,
    phase: "setup",
    activePlayerId: null,
    secrets: makeRecord(state.playerIds, () => null),
    progress: {},
    roundNumber: state.roundNumber + 1,
    roundWinnerId: null,
    winnerId: null,
    lastGuess: null
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
      return { state: current, activePlayerId: current.activePlayerId, message: "참여 중인 플레이어만 행동할 수 있습니다." };
    }

    if (action.type === "hangman-board-game/next-round") {
      if (current.phase !== "round-complete") {
        return { state: current, activePlayerId: current.activePlayerId, message: "다음 라운드를 시작할 수 있는 상태가 아닙니다." };
      }
      const nextState = nextRoundState(current);
      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} 다음 라운드 시작`,
        activePlayerId: null,
        phase: nextState.phase,
        roundNumber: nextState.roundNumber,
        message: `${nextState.roundNumber}라운드 비밀 단어를 입력하세요.`
      };
    }

    if (action.type === "hangman-board-game/setup-secret") {
      if (current.phase !== "setup") {
        return { state: current, activePlayerId: current.activePlayerId, message: "비밀 단어는 이미 확정되었습니다." };
      }

      const word = readWord(action);
      if (!word) {
        return { state: current, activePlayerId: current.activePlayerId, message: `영문 1~${MAX_WORD_LENGTH}글자만 입력할 수 있습니다.` };
      }
      if (current.secrets[playerId]) {
        return { state: current, activePlayerId: current.activePlayerId, message: "이미 비밀 단어를 제출했습니다." };
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
        log: `${getPlayerName(context.players, playerId)} 비밀 단어 제출`,
        activePlayerId,
        phase: nextState.phase,
        roundNumber: nextState.roundNumber
      };
    }

    if (current.phase !== "guessing") {
      return { state: current, activePlayerId: current.activePlayerId, message: "아직 추측할 수 있는 라운드가 아닙니다." };
    }
    if (current.activePlayerId !== playerId) {
      return { state: current, activePlayerId: current.activePlayerId, message: "내 추측 차례를 기다려주세요." };
    }

    const playerProgress = current.progress[playerId];
    if (!playerProgress) {
      return { state: current, activePlayerId: current.activePlayerId, message: "추측할 대상 단어가 아직 준비되지 않았습니다." };
    }
    const targetSecret = current.secrets[playerProgress.targetId] ?? "";

    if (action.type === "hangman-board-game/guess-letter") {
      const letter = readLetter(action);
      if (!letter) {
        return { state: current, activePlayerId: current.activePlayerId, message: "알파벳 한 글자를 골라주세요." };
      }
      if (playerProgress.guessedLetters.includes(letter)) {
        return { state: current, activePlayerId: current.activePlayerId, message: "이미 추측한 글자입니다." };
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
          log: `${getPlayerName(context.players, playerId)} 단어 맞힘`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          phase: nextState.phase,
          winnerId: nextState.winnerId
        };
      }
      if (nextPlayerProgress.misses >= MAX_MISSES) {
        const nextState = completeRound(current, playerProgress.targetId, progress, lastGuess);
        return {
          state: nextState,
          log: `${getPlayerName(context.players, playerId)} 오답 한도 도달`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          phase: nextState.phase,
          winnerId: nextState.winnerId
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
        log: `${getPlayerName(context.players, playerId)} ${letter} 추측`,
        activePlayerId,
        turnNumber: context.turnNumber + 1,
        phase: nextState.phase
      };
    }

    if (action.type === "hangman-board-game/guess-word") {
      const word = readWord(action);
      if (!word) {
        return { state: current, activePlayerId: current.activePlayerId, message: `영문 1~${MAX_WORD_LENGTH}글자만 입력할 수 있습니다.` };
      }
      if (playerProgress.wholeWordGuesses.includes(word)) {
        return { state: current, activePlayerId: current.activePlayerId, message: "이미 추측한 전체 단어입니다." };
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
          log: `${getPlayerName(context.players, playerId)} 전체 단어 맞힘`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          phase: nextState.phase,
          winnerId: nextState.winnerId
        };
      }
      if (nextPlayerProgress.misses >= MAX_MISSES) {
        const nextState = completeRound(current, playerProgress.targetId, progress, lastGuess);
        return {
          state: nextState,
          log: `${getPlayerName(context.players, playerId)} 오답 한도 도달`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          phase: nextState.phase,
          winnerId: nextState.winnerId
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
        log: `${getPlayerName(context.players, playerId)} 전체 단어 추측`,
        activePlayerId,
        turnNumber: context.turnNumber + 1,
        phase: nextState.phase
      };
    }

    return { state: current, activePlayerId: current.activePlayerId, message: "지원하지 않는 행맨 행동입니다." };
  }
};

function WordDisplay({ letters }: { letters: string[] }) {
  return (
    <div className="hangman-word-display" style={styles.wordDisplay} aria-label="단어 표시">
      {letters.map((letter, index) => (
        <span className="hangman-letter-slot" style={styles.letterSlot} key={`${letter}-${index}`}>
          {letter}
        </span>
      ))}
    </div>
  );
}

function HangmanToyBoard({ misses = 0, maxMisses = MAX_MISSES }: { misses?: number; maxMisses?: number }) {
  return (
    <div className="hangman-toy-board" aria-hidden="true">
      <div className="hangman-toy-letters">
        {ALPHABET.map((letter, index) => (
          <span className={index % 2 === 0 ? "red" : "blue"} key={letter}>
            {letter}
          </span>
        ))}
      </div>
      <div className="hangman-toy-figure">
        <div className="hangman-gallows">
          <span className="hangman-post" />
          <span className="hangman-beam" />
          <span className="hangman-rope" />
          <span className={`hangman-figure head ${misses >= 1 ? "lit" : ""}`} />
          <span className={`hangman-figure body ${misses >= 2 ? "lit" : ""}`} />
          <span className={`hangman-figure arm-left ${misses >= 3 ? "lit" : ""}`} />
          <span className={`hangman-figure arm-right ${misses >= 4 ? "lit" : ""}`} />
          <span className={`hangman-figure leg-left ${misses >= 5 ? "lit" : ""}`} />
          <span className={`hangman-figure leg-right ${misses >= 6 ? "lit" : ""}`} />
        </div>
        <div className="hangman-miss-track">
          {Array.from({ length: maxMisses }, (_, index) => (
            <span className={index < misses ? "lit" : ""} key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HangmanMissCounter({ misses, maxMisses }: { misses: number; maxMisses: number }) {
  const remaining = Math.max(0, maxMisses - misses);
  return (
    <div className="hangman-miss-counter" aria-label={`남은 기회 ${remaining}개, 오답 ${misses}개`}>
      <div>
        <strong>{remaining}</strong>
        <span>남은 기회</span>
      </div>
      <div className="hangman-miss-pips" aria-hidden="true">
        {Array.from({ length: maxMisses }, (_, index) => (
          <span className={index < misses ? "spent" : ""} key={index} />
        ))}
      </div>
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
  const [showOwnSecret, setShowOwnSecret] = useState(false);
  const [wholeWord, setWholeWord] = useState("");
  const myId = currentPlayer?.id ?? null;
  const myProgress = myId ? state.progress[myId] : undefined;
  const isMyTurn = Boolean(myId && state.activePlayerId === myId && state.phase === "guessing");
  const canGuess = !disabled && isMyTurn;
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [state.phase, state.activePlayerId, state.roundNumber, state.roundWinnerId, state.winnerId, state.lastGuess?.kind, state.lastGuess?.guess],
    { cooldownMs: 520 }
  );
  const guessedLetters = new Set(myProgress?.guessedLetters ?? []);
  const missedLetters = new Set(myProgress?.missedLetters ?? []);
  const hitLetters = new Set((myProgress?.guessedLetters ?? []).filter((letter) => !missedLetters.has(letter)));
  const roundWinnerName = getPlayerName(players, state.roundWinnerId);
  const targetName = myProgress ? getPlayerName(players, myProgress.targetId) : null;
  const targetLetters = myProgress ? state.displays[myProgress.targetId] ?? [] : [];

  function submitSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = normalizeWord(secretWord);
    if (!word) {
      return;
    }
    if (!submitAction({ type: "hangman-board-game/setup-secret", payload: { word } })) {
      return;
    }
    setSecretWord("");
    setShowOwnSecret(false);
  }

  function submitWholeWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = normalizeWord(wholeWord);
    if (!word) {
      return;
    }
    if (!submitAction({ type: "hangman-board-game/guess-word", payload: { word } })) {
      return;
    }
    setWholeWord("");
  }

  return (
    <section className={`game-module hangman-module ${isSubmitting ? "is-submitting" : ""}`} style={styles.shell} aria-label="행맨 보드게임">
      {state.phase === "setup" ? (
        <article className="hangman-setup-panel" style={styles.panel}>
          <h3>비밀 단어 준비</h3>
          <HangmanToyBoard maxMisses={state.maxMisses} />
          <div className="hangman-setup-grid" style={styles.grid}>
            {state.playerIds.map((playerId) => (
              <div className="hangman-player-setup" key={playerId}>
                <strong>{getPlayerName(players, playerId)}</strong>
                <p>{state.setup.submitted[playerId] ? "제출 완료" : "입력 대기"}</p>
                {myId === playerId && state.setup.ownSecret ? (
                  <div className="hangman-secret-lock">
                    <p>{showOwnSecret ? `내 단어: ${state.setup.ownSecret}` : "내 단어 숨김"}</p>
                    <button type="button" onClick={() => setShowOwnSecret((value) => !value)}>
                      {showOwnSecret ? "숨기기" : "확인"}
                    </button>
                    <small>교대 전 숨기기</small>
                  </div>
                ) : null}
                {myId !== playerId && state.setup.wordLengths[playerId] > 0 ? <p>빈칸 {state.setup.wordLengths[playerId]}</p> : null}
              </div>
            ))}
          </div>
          {myId && !state.setup.submitted[myId] ? (
            <form className="hangman-secret-form" style={styles.form} onSubmit={submitSecret}>
              <label style={styles.inputGroup}>
                비밀 단어
                <input
                  value={secretWord}
                  maxLength={MAX_WORD_LENGTH}
                  pattern="[A-Za-z가-힣]{1,8}"
                  autoCapitalize="characters"
                  onChange={(event) => setSecretWord(event.currentTarget.value)}
                />
              </label>
              <button type="submit" disabled={disabled || isSubmitting || !normalizeWord(secretWord)}>
                제출
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
                  <p>{isOwnSecret ? "내 비밀 단어" : "상대 단어"}</p>
                  <WordDisplay letters={state.displays[playerId] ?? []} />
                </article>
              );
            })}
          </div>

          <article
            className="hangman-guess-panel"
            style={{ ...styles.panel, "--misses": myProgress?.misses ?? 0 } as CSSProperties}
          >
              <div className="hangman-turn-meta" style={styles.meta}>
                <strong>
                {state.phase === "complete"
                  ? "매치 종료"
                  : state.phase === "round-complete"
                    ? "라운드 종료"
                    : `${getPlayerName(players, state.activePlayerId)} 추측 차례`}
              </strong>
              {myProgress ? (
                <span>
                  오답: {myProgress.misses}/{state.maxMisses}
                </span>
              ) : null}
            </div>

            <div className="hangman-target-card">
              <div>
                <strong>{targetName ? `${targetName} 단어` : "대기"}</strong>
                <WordDisplay letters={targetLetters} />
              </div>
              <HangmanMissCounter misses={myProgress?.misses ?? 0} maxMisses={state.maxMisses} />
            </div>

            {state.phase === "round-complete" ? (
              <div className="hangman-round-complete">
                <strong>{roundWinnerName} 라운드 승리</strong>
                <span>
                  {state.roundNumber}라운드 종료 · 목표 {state.targetWins}승
                </span>
                <button type="button" disabled={isSubmitting} onClick={() => submitAction({ type: "hangman-board-game/next-round" })}>
                  다음 라운드
                </button>
              </div>
            ) : null}

            {state.phase === "complete" ? (
              <div className="hangman-round-complete">
                <strong>{getPlayerName(players, state.winnerId)} 최종 승리</strong>
                <span>
                  {state.roundNumber}라운드 · {state.targetWins}승 선취
                </span>
              </div>
            ) : null}

            <div className="hangman-console-top" aria-hidden="true">
              <HangmanToyBoard misses={myProgress?.misses ?? 0} maxMisses={state.maxMisses} />
            </div>

            <div className="hangman-alphabet" style={styles.alphabet}>
              {ALPHABET.map((letter) => (
                <button
                  className={[
                    "hangman-letter-button",
                    missedLetters.has(letter) ? "missed" : "",
                    hitLetters.has(letter) ? "hit" : "",
                    guessedLetters.has(letter) ? "used" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={styles.letterButton}
                  type="button"
                  key={letter}
                  disabled={!canGuess || isSubmitting || guessedLetters.has(letter)}
                  onClick={() => submitAction({ type: "hangman-board-game/guess-letter", payload: { letter } })}
                >
                  {letter}
                </button>
              ))}
            </div>

            <form className="hangman-word-guess-form" style={{ ...styles.form, marginTop: "0.75rem" }} onSubmit={submitWholeWord}>
              <label style={styles.inputGroup}>
                전체 단어 추측
                <input
                  value={wholeWord}
                  maxLength={MAX_WORD_LENGTH}
                  pattern="[A-Za-z가-힣]{1,8}"
                  autoCapitalize="characters"
                  onChange={(event) => setWholeWord(event.currentTarget.value)}
                />
              </label>
              <button type="submit" disabled={!canGuess || isSubmitting || !normalizeWord(wholeWord)}>
                단어 추측
              </button>
            </form>

            {myProgress ? (
              <div className="hangman-history-strip">
                <span>틀린 글자: {myProgress.missedLetters.join(", ") || "없음"}</span>
              </div>
            ) : null}

            {state.phase === "complete" ? <p>승자: {state.winnerId ? getPlayerName(players, state.winnerId) : "승자 없음"}</p> : null}
          </article>
        </>
      ) : null}
    </section>
  );
}
