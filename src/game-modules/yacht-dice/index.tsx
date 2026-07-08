import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule, GameSystemAction } from "../types";
import type { PlayerSnapshot } from "../../shared/types";
import { useInteractionGate } from "../useInteractionGate";

const DICE_COUNT = 5;
const MAX_ROLLS = 3;
const DIE_PIP_MAP: Record<DieValue, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

const CATEGORIES = [
  { id: "ones", label: "1" },
  { id: "twos", label: "2" },
  { id: "threes", label: "3" },
  { id: "fours", label: "4" },
  { id: "fives", label: "5" },
  { id: "sixes", label: "6" },
  { id: "choice", label: "초이스" },
  { id: "fourKind", label: "포카드" },
  { id: "fullHouse", label: "풀하우스" },
  { id: "smallStraight", label: "스몰 스트레이트" },
  { id: "largeStraight", label: "라지 스트레이트" },
  { id: "yacht", label: "요트" }
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];
type DieValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const UPPER_CATEGORY_IDS = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const satisfies CategoryId[];
const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS_SCORE = 35;

const scoreSheetLabels: Record<CategoryId, string> = {
  ones: "1",
  twos: "2",
  threes: "3",
  fours: "4",
  fives: "5",
  sixes: "6",
  choice: "초이스",
  fourKind: "포카드",
  fullHouse: "풀하우스",
  smallStraight: "스몰 스트레이트",
  largeStraight: "라지 스트레이트",
  yacht: "요트"
};

const DIE_TRAY_POSITIONS = [
  { x: "18%", y: "31%", holdX: "12%", holdY: "87%", r: "-8deg", rollX: "16px", rollY: "-12px", rollR: "82deg" },
  { x: "37%", y: "23%", holdX: "31%", holdY: "87%", r: "6deg", rollX: "-14px", rollY: "15px", rollR: "-74deg" },
  { x: "58%", y: "35%", holdX: "50%", holdY: "87%", r: "-3deg", rollX: "13px", rollY: "-18px", rollR: "68deg" },
  { x: "77%", y: "27%", holdX: "69%", holdY: "87%", r: "9deg", rollX: "-18px", rollY: "-9px", rollR: "-92deg" },
  { x: "49%", y: "52%", holdX: "88%", holdY: "87%", r: "-12deg", rollX: "17px", rollY: "13px", rollR: "96deg" }
] as const;

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
  upperTotals: Record<string, number>;
  upperBonuses: Record<string, number>;
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
    gridTemplateColumns: "repeat(auto-fit, minmax(3rem, 1fr))",
    gap: "0.45rem"
  },
  dieButton: {
    minHeight: "4rem",
    minWidth: 0,
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
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat || a.joinedAt - b.joinedAt)
    .slice(0, count)
    .map((player) => player.id);
}

function getPlayerName(players: PlayerSnapshot[], playerId: string | null) {
  if (!playerId) {
    return "플레이어 없음";
  }
  return players.find((player) => player.id === playerId)?.name ?? "플레이어";
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
      return sortedCounts.length === 2 && sortedCounts[0] === 2 && sortedCounts[1] === 3 ? 25 : 0;
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
  const categoryTotal = CATEGORIES.reduce((total, category) => total + (scores[category.id] ?? 0), 0);
  return categoryTotal + upperBonus(scores);
}

function upperScore(scores: ScoreSheet) {
  return UPPER_CATEGORY_IDS.reduce((total, category) => total + (scores[category] ?? 0), 0);
}

function upperBonus(scores: ScoreSheet) {
  return upperScore(scores) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0;
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

function openCategories(scores: ScoreSheet) {
  return CATEGORIES.filter((category) => scores[category.id] === undefined).map((category) => category.id);
}

function lowestScoringOpenCategory(scores: ScoreSheet, dice: DieValue[]) {
  const open = openCategories(scores);
  return open.sort((left, right) => scoreCategory(left, dice) - scoreCategory(right, dice))[0] ?? null;
}

function scoreTurn(
  current: YachtState,
  context: GameContext,
  playerId: string,
  category: CategoryId,
  logPrefix?: string
): GameActionResult {
  const playerScores = current.scores[playerId] ?? {};
  if (playerScores[category] !== undefined) {
    return { state: current, activePlayerId: current.activePlayerId, message: "이미 채운 점수 칸입니다." };
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
    log: `${logPrefix ?? getPlayerName(context.players, playerId)} ${categoryLabel}에 ${score}점 기록`,
    activePlayerId,
    turnNumber: context.turnNumber + 1,
    phase: nextState.phase,
    winnerId: nextState.winnerId
  };
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
  const upperTotals: Record<string, number> = {};
  const upperBonuses: Record<string, number> = {};
  for (const playerId of state.playerIds) {
    const scores = state.scores[playerId] ?? {};
    totals[playerId] = totalScore(scores);
    upperTotals[playerId] = upperScore(scores);
    upperBonuses[playerId] = upperBonus(scores);
  }

  return { ...state, totals, upperTotals, upperBonuses };
}

export const module: GameModule = {
  id: "yacht-dice",
  createInitialState: createState,
  getPublicState: (state) => publicStateFrom(state as YachtState),
  applyAction: (state, action, context) => {
    const current = state as YachtState;

    if (current.phase === "complete") {
      return { state: current, activePlayerId: null, message: "점수표가 모두 채워졌습니다." };
    }

    const playerId = context.currentPlayerId;
    if (current.activePlayerId !== playerId) {
      return { state: current, activePlayerId: current.activePlayerId, message: "내 주사위 차례를 기다려주세요." };
    }

    if (action.type === "yacht-dice/roll") {
      if (current.rollsThisTurn >= MAX_ROLLS) {
        return { state: current, activePlayerId: current.activePlayerId, message: "이번 턴의 3번 굴림을 모두 사용했습니다." };
      }

      const dice = current.dice.map((die, index) => (current.held[index] && die > 0 ? die : rollDie()));
      const nextState: YachtState = {
        ...current,
        dice,
        rollsThisTurn: current.rollsThisTurn + 1
      };

      return {
        state: nextState,
        log: `${getPlayerName(context.players, playerId)} 주사위 굴림`,
        activePlayerId: nextState.activePlayerId,
        phase: nextState.phase
      };
    }

    if (action.type === "yacht-dice/toggle-hold") {
      if (current.rollsThisTurn === 0) {
        return { state: current, activePlayerId: current.activePlayerId, message: "주사위를 먼저 굴린 뒤 보류할 수 있습니다." };
      }

      const index = readDieIndex(action);
      if (index === null) {
        return { state: current, activePlayerId: current.activePlayerId, message: "보류할 주사위를 올바르게 골라주세요." };
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
        return { state: current, activePlayerId: current.activePlayerId, message: "주사위를 먼저 굴린 뒤 점수를 기록할 수 있습니다." };
      }

      const category = readCategory(action);
      if (!category) {
        return { state: current, activePlayerId: current.activePlayerId, message: "점수 칸을 올바르게 골라주세요." };
      }

      const playerScores = current.scores[playerId] ?? {};
      if (playerScores[category] !== undefined) {
        return { state: current, activePlayerId: current.activePlayerId, message: "이미 채운 점수 칸입니다." };
      }

      return scoreTurn(current, context, playerId, category);
    }

    return { state: current, activePlayerId: current.activePlayerId, message: "지원하지 않는 요트 다이스 행동입니다." };
  },
  applySystemAction: (state, action: GameSystemAction, context) => {
    const current = state as YachtState;
    if (current.phase === "complete") {
      return { state: current, activePlayerId: null, phase: "complete", winnerId: current.winnerId };
    }
    const playerId = context.activePlayerId;
    if (!playerId || current.activePlayerId !== playerId) {
      return { state: current, activePlayerId: current.activePlayerId, message: "현재 차례 플레이어를 찾을 수 없습니다." };
    }
    if (action.type === "system/pass") {
      throw new Error("요트 다이스는 점수칸을 기록해야 턴을 끝낼 수 있습니다.");
    }

    const dice = current.rollsThisTurn === 0 ? emptyDice() : current.dice;
    const category = lowestScoringOpenCategory(current.scores[playerId] ?? {}, dice);
    if (!category) {
      return { state: current, activePlayerId: current.activePlayerId, message: "기록할 수 있는 점수칸이 없습니다." };
    }
    const timedOutState: YachtState = current.rollsThisTurn === 0 ? { ...current, dice } : current;
    return scoreTurn(timedOutState, context, playerId, category, `${getPlayerName(context.players, playerId)} 시간 초과 자동 기록`);
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
  const activeUpperTotal = activePlayerId ? state.upperTotals[activePlayerId] ?? 0 : 0;
  const activeUpperBonus = activePlayerId ? state.upperBonuses[activePlayerId] ?? 0 : 0;
  const isMyTurn = Boolean(currentPlayer?.id && currentPlayer.id === activePlayerId && state.phase === "rolling");
  const canAct = !disabled && isMyTurn;
  const rollsLeft = MAX_ROLLS - state.rollsThisTurn;
  const [rolling, setRolling] = useState(false);
  const rollTimerRef = useRef<number | null>(null);
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [activePlayerId, state.rollsThisTurn, state.lastScored?.playerId, state.lastScored?.category, state.phase],
    { cooldownMs: 360 }
  );

  useEffect(() => {
    return () => {
      if (rollTimerRef.current !== null) {
        window.clearTimeout(rollTimerRef.current);
      }
    };
  }, []);

  function roleLabel(playerId: string) {
    if (playerId === currentPlayer?.id && playerId === activePlayerId) {
      return "나 · 차례";
    }
    if (playerId === currentPlayer?.id) {
      return "나";
    }
    if (playerId === activePlayerId) {
      return "현재 차례";
    }
    return "상대";
  }

  function rollDice() {
    if (!canAct || state.rollsThisTurn >= MAX_ROLLS || rolling || isSubmitting) {
      return;
    }
    if (!submitAction({ type: "yacht-dice/roll" })) {
      return;
    }
    if (rollTimerRef.current !== null) {
      window.clearTimeout(rollTimerRef.current);
    }
    setRolling(true);
    rollTimerRef.current = window.setTimeout(() => {
      setRolling(false);
      rollTimerRef.current = null;
    }, 760);
  }

  function scoreTurn(categoryId: CategoryId) {
    if (!canAct || rolling || state.rollsThisTurn === 0) {
      return;
    }
    submitAction({ type: "yacht-dice/score-category", payload: { category: categoryId } });
  }

  function dieTrayStyle(index: number, held: boolean): CSSProperties {
    const position = DIE_TRAY_POSITIONS[index] ?? DIE_TRAY_POSITIONS[0];
    return {
      "--die-x": held ? position.holdX : position.x,
      "--die-y": held ? "calc(100% - 30px)" : position.y,
      "--die-r": held ? "0deg" : position.r,
      "--die-roll-x": position.rollX,
      "--die-roll-y": position.rollY,
      "--die-roll-r": position.rollR
    } as CSSProperties;
  }

  function renderDieFace(die: DieValue) {
    return (
      <span className="yacht-die-face" aria-hidden="true">
        {Array.from({ length: 9 }, (_, pipIndex) => (
          <span
            className={`yacht-pip ${DIE_PIP_MAP[die].includes(pipIndex) ? "on" : ""}`}
            key={pipIndex}
          />
        ))}
      </span>
    );
  }

  const dockedDice = state.dice
    .map((die, index) => ({ die, index }))
    .filter((item) => state.held[item.index]);

  return (
    <section className="game-module yacht-dice-module" style={styles.shell} aria-label="요트 다이스 보드">
      <div className="yacht-top-grid" style={styles.topGrid}>
        <article className="yacht-dice-panel" style={styles.panel}>
          <div className="yacht-dice-panel-head">
            <div>
              <h3>주사위</h3>
              <p>
                {state.phase === "complete" ? "게임 종료" : `${getPlayerName(players, activePlayerId)} 차례`} · 남은 굴림 {Math.max(0, rollsLeft)}
              </p>
            </div>
            <strong>{state.rollsThisTurn}/{MAX_ROLLS}</strong>
          </div>
          <div className={`yacht-throw-tray ${rolling ? "rolling" : ""}`} aria-label="주사위 던지는 판">
            <div className="yacht-keep-slots" aria-label="보류 주사위 슬롯">
              {Array.from({ length: DICE_COUNT }, (_, slotIndex) => {
                const docked = dockedDice[slotIndex];
                return docked ? (
                  <button
                    className="yacht-dock-slot filled"
                    type="button"
                    key={`dock-${docked.index}`}
                    disabled={!canAct || state.rollsThisTurn === 0 || rolling || isSubmitting}
                    aria-pressed="true"
                    aria-label={`${docked.index + 1}번 주사위 ${docked.die || "아직 안 굴림"} 보류 해제`}
                    onClick={() => onAction({ type: "yacht-dice/toggle-hold", payload: { index: docked.index } })}
                  >
                    {renderDieFace(docked.die)}
                  </button>
                ) : (
                  <span className="yacht-dock-slot" key={`dock-empty-${slotIndex}`} aria-hidden="true" />
                );
              })}
            </div>
            {state.dice.map((die, index) => state.held[index] ? null : (
              <button
                className={`yacht-die-button ${rolling ? "rolling" : ""}`}
                style={dieTrayStyle(index, false)}
                type="button"
                key={`die-${index}`}
                disabled={!canAct || state.rollsThisTurn === 0 || rolling || isSubmitting}
                aria-pressed="false"
                aria-label={`${index + 1}번 주사위 ${die || "아직 안 굴림"} 보류 전환`}
                onClick={() => onAction({ type: "yacht-dice/toggle-hold", payload: { index } })}
              >
                {renderDieFace(die)}
                <span className="yacht-die-label">자유</span>
              </button>
            ))}
          </div>
          <div className="yacht-actions" style={{ ...styles.actionRow, marginTop: "0.75rem" }}>
            <button
              type="button"
              className={`yacht-roll-button ${rolling ? "rolling" : ""}`}
              disabled={!canAct || state.rollsThisTurn >= MAX_ROLLS || rolling || isSubmitting}
              onClick={rollDice}
            >
              {rolling ? "굴리는 중" : state.rollsThisTurn === 0 ? "주사위 굴리기" : "다시 굴리기"}
            </button>
            {state.lastScored ? (
              <span>
                최근 점수: {getPlayerName(players, state.lastScored.playerId)} +{state.lastScored.score}
              </span>
            ) : null}
          </div>
        </article>

        <article className="yacht-score-panel" style={styles.panel}>
          <div className="yacht-score-panel-head">
            <h3>점수 선택</h3>
            <span>{getPlayerName(players, activePlayerId)}</span>
          </div>
          <div className="yacht-bonus-strip">
            <span>상단 합계 {activeUpperTotal}/{UPPER_BONUS_THRESHOLD}</span>
            <strong>{activeUpperBonus > 0 ? `보너스 +${activeUpperBonus}` : `보너스까지 ${Math.max(0, UPPER_BONUS_THRESHOLD - activeUpperTotal)}`}</strong>
          </div>
          <div className="yacht-score-choice-list" aria-label="이번 턴 점수칸">
            {CATEGORIES.map((category) => {
              const usedScore = activeScores[category.id];
              const preview = state.rollsThisTurn > 0 ? scoreCategory(category.id, state.dice) : 0;
              const score = usedScore ?? preview;
              const locked = usedScore !== undefined;
              return (
                <button
                  type="button"
                  className={`yacht-score-choice ${locked ? "used" : ""}`}
                  key={category.id}
                  disabled={locked || !canAct || rolling || isSubmitting || state.rollsThisTurn === 0}
                  aria-label={`${category.label} ${score}점 선택`}
                  onClick={() => scoreTurn(category.id)}
                >
                  <span className="yacht-score-choice-label">
                    {category.label}
                  </span>
                  <strong className="yacht-score-choice-value">{score}</strong>
                </button>
              );
            })}
          </div>
        </article>
      </div>

      <article className="yacht-scoreboard" style={styles.panel}>
        <div className="yacht-scoreboard-head">
          <h3>점수판</h3>
          <span>{state.playerIds.length}명 전체 점수</span>
        </div>
        <div className="yacht-player-scorecards">
          {state.playerIds.map((playerId) => (
            <article
              className={`yacht-player-scorecard ${playerId === activePlayerId ? "active" : ""} ${playerId === currentPlayer?.id ? "current" : ""}`}
              key={playerId}
            >
              <header>
                <span className="yacht-player-title">
                  <strong>{getPlayerName(players, playerId)}</strong>
                  <small>{roleLabel(playerId)}</small>
                </span>
                <span>{state.totals[playerId] ?? 0}점</span>
              </header>
              <div className="yacht-player-score-summary">
                <span>상 {state.upperTotals[playerId] ?? 0}</span>
                <span>+35 {state.upperBonuses[playerId] ? `+${state.upperBonuses[playerId]}` : "-"}</span>
              </div>
              <div className="yacht-player-category-grid" aria-label={`${getPlayerName(players, playerId)} 점수`}>
                {CATEGORIES.map((category) => (
                  <span key={category.id}>
                    <i>{scoreSheetLabels[category.id]}</i>
                    <b>{state.scores[playerId]?.[category.id] ?? "-"}</b>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
        {state.phase === "complete" ? (
          <p>승자: {state.winnerId ? getPlayerName(players, state.winnerId) : "무승부"}</p>
        ) : null}
      </article>
    </section>
  );
}
