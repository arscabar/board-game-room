import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const BOARD_SIZE = 4;
const STARTING_RESERVE = 8;
const NEUTRAL = "neutral";

type Stone = string;

interface Coord {
  row: number;
  col: number;
}

interface QawalePlayer {
  id: string;
  name: string;
  seat: number;
  color: string;
}

interface QawaleState {
  players: QawalePlayer[];
  board: Stone[][][];
  reserves: Record<string, number>;
  phase: "playing" | "complete";
  winnerId: string | null;
  message: string;
}

type QawalePublicState = QawaleState;

interface DistributePayload {
  source: Coord;
  path: Coord[];
}

const playerColors = ["#315c8c", "#d69b2d"];

function key(row: number, col: number) {
  return `${row},${col}`;
}

function isCoord(value: unknown): value is Coord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.row) && Number.isInteger(item.col);
}

function isDistributePayload(value: unknown): value is DistributePayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isCoord(item.source) && Array.isArray(item.path) && item.path.every(isCoord);
}

function inBoard(row: number, col: number) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function adjacent(a: Coord, b: Coord) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function neighbors(coord: Coord) {
  return [
    { row: coord.row - 1, col: coord.col },
    { row: coord.row + 1, col: coord.col },
    { row: coord.row, col: coord.col - 1 },
    { row: coord.row, col: coord.col + 1 }
  ].filter((next) => inBoard(next.row, next.col));
}

function sameCoord(a: Coord, b: Coord) {
  return a.row === b.row && a.col === b.col;
}

function cloneBoard(board: Stone[][][]) {
  return board.map((row) => row.map((stack) => [...stack]));
}

function cloneState(state: QawaleState): QawaleState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    board: cloneBoard(state.board),
    reserves: { ...state.reserves }
  };
}

function topStone(state: QawaleState, row: number, col: number) {
  const stack = state.board[row][col];
  return stack[stack.length - 1] ?? null;
}

function playerName(state: QawaleState, playerId: string) {
  return state.players.find((player) => player.id === playerId)?.name ?? "플레이어";
}

function validatePath(source: Coord, path: Coord[], carryLength: number) {
  if (path.length !== carryLength) {
    throw new Error(`경로는 ${carryLength}칸이어야 합니다.`);
  }

  for (let index = 0; index < path.length; index += 1) {
    const current = index === 0 ? source : path[index - 1];
    const target = path[index];
    if (!inBoard(target.row, target.col) || !adjacent(current, target)) {
      throw new Error("분배 경로는 상하좌우 인접 칸으로 한 칸씩 이어져야 합니다.");
    }

    if (index > 0) {
      const previous = index === 1 ? source : path[index - 2];
      if (sameCoord(target, previous)) {
        throw new Error("방금 지나온 칸으로 바로 되돌아갈 수 없습니다.");
      }
    }
  }
}

function lineWinner(state: QawaleState) {
  const lines: Coord[][] = [];

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    lines.push(
      Array.from({ length: BOARD_SIZE }, (_, col) => ({ row: index, col })),
      Array.from({ length: BOARD_SIZE }, (_, row) => ({ row, col: index }))
    );
  }

  lines.push(
    Array.from({ length: BOARD_SIZE }, (_, index) => ({ row: index, col: index })),
    Array.from({ length: BOARD_SIZE }, (_, index) => ({ row: index, col: BOARD_SIZE - 1 - index }))
  );

  for (const line of lines) {
    const owner = topStone(state, line[0].row, line[0].col);
    if (owner && owner !== NEUTRAL && line.every((coord) => topStone(state, coord.row, coord.col) === owner)) {
      return owner;
    }
  }

  return null;
}

function connectedModulePlayers(state: QawaleState, context: GameContext) {
  return state.players.filter((player) =>
    context.players.some((candidate) => candidate.id === player.id && candidate.connected)
  );
}

function advanceTurn(state: QawaleState, context: GameContext) {
  const order = connectedModulePlayers(state, context);
  if (order.length === 0) {
    return { activePlayerId: null, turnNumber: context.turnNumber + 1, roundNumber: context.roundNumber };
  }

  const currentIndex = order.findIndex((player) => player.id === context.activePlayerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
  return {
    activePlayerId: order[nextIndex].id,
    turnNumber: context.turnNumber + 1,
    roundNumber: context.roundNumber + (currentIndex !== -1 && nextIndex === 0 ? 1 : 0)
  };
}

function requireActivePlayer(state: QawaleState, context: GameContext) {
  if (state.phase === "complete" || state.winnerId) {
    throw new Error("이미 종료된 게임입니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("카왈레 플레이어를 찾을 수 없습니다.");
  }
  return player;
}

function createInitialBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => [] as Stone[])
  );
  for (const corner of [
    { row: 0, col: 0 },
    { row: 0, col: BOARD_SIZE - 1 },
    { row: BOARD_SIZE - 1, col: 0 },
    { row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 }
  ]) {
    board[corner.row][corner.col] = [NEUTRAL, NEUTRAL];
  }
  return board;
}

function createInitialState(context: Pick<GameContext, "players">): QawaleState {
  const seatedPlayers = context.players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 2);
  const reserves: Record<string, number> = {};

  for (const player of seatedPlayers) {
    reserves[player.id] = STARTING_RESERVE;
  }

  return {
    players: seatedPlayers.map((player, index) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      color: playerColors[index]
    })),
    board: createInitialBoard(),
    reserves,
    phase: "playing",
    winnerId: null,
    message: "비어 있지 않은 스택을 고르고 자기 돌을 얹은 뒤 스택을 분배하세요."
  };
}

function distribute(state: QawaleState, action: GameAction, context: GameContext): GameActionResult {
  if (!isDistributePayload(action.payload)) {
    throw new Error("출발 스택과 분배 경로가 필요합니다.");
  }

  const player = requireActivePlayer(state, context);
  const { source, path } = action.payload;
  if (!inBoard(source.row, source.col)) {
    throw new Error("출발 칸이 보드 밖입니다.");
  }
  const sourceStack = state.board[source.row][source.col];
  if (sourceStack.length === 0) {
    throw new Error("비어 있지 않은 스택만 고를 수 있습니다.");
  }
  if ((state.reserves[player.id] ?? 0) <= 0) {
    throw new Error("남은 자기 돌이 없습니다.");
  }

  const carry = [...sourceStack, player.id];
  validatePath(source, path, carry.length);

  const next = cloneState(state);
  next.board[source.row][source.col] = [];
  next.reserves[player.id] -= 1;
  for (let index = 0; index < carry.length; index += 1) {
    const destination = path[index];
    next.board[destination.row][destination.col].push(carry[index]);
  }

  const winnerId = lineWinner(next);
  if (winnerId) {
    next.phase = "complete";
    next.winnerId = winnerId;
    next.message = `${playerName(next, winnerId)}님이 보이는 4목을 만들었습니다.`;
    return {
      state: next,
      log: `${playerName(next, winnerId)} 보이는 4목 승리`,
      activePlayerId: null,
      phase: "complete",
      winnerId,
      message: next.message
    };
  }

  const outOfStones = next.players.every((candidate) => (next.reserves[candidate.id] ?? 0) <= 0);
  if (outOfStones) {
    next.phase = "complete";
    next.message = "모든 돌을 사용했지만 4목이 없어 무승부입니다.";
    return {
      state: next,
      log: "카왈레 무승부 종료",
      activePlayerId: null,
      phase: "complete",
      winnerId: null,
      message: next.message
    };
  }

  next.message = `${player.name}님이 ${source.row + 1}-${source.col + 1} 스택에서 돌 ${carry.length}개를 분배했습니다.`;
  return {
    state: next,
    log: `${player.name} 스택 분배`,
    message: next.message,
    ...advanceTurn(next, context)
  };
}

export const module: GameModule = {
  id: "qawale",
  createInitialState,
  getPublicState: (state) => state as QawalePublicState,
  applyAction: (state, action, context) => {
    if (action.type === "distribute") {
      return distribute(state as QawaleState, action, context);
    }
    throw new Error("지원하지 않는 카왈레 행동입니다.");
  }
};

function stoneColor(state: QawalePublicState, stone: Stone | null) {
  if (!stone) return "transparent";
  if (stone === NEUTRAL) return "#eef0e8";
  return state.players.find((player) => player.id === stone)?.color ?? "#52625d";
}

function stoneLabel(state: QawalePublicState, stone: Stone | null) {
  if (!stone) return "";
  if (stone === NEUTRAL) return "중";
  return String(state.players.find((player) => player.id === stone)?.seat ?? "?");
}

function stoneName(state: QawalePublicState, stone: Stone | null) {
  if (!stone) return "없음";
  if (stone === NEUTRAL) return "중립";
  return state.players.find((player) => player.id === stone)?.name ?? "플레이어";
}

function visibleTopCounts(state: QawalePublicState) {
  const counts: Record<string, number> = { [NEUTRAL]: 0 };
  for (const player of state.players) counts[player.id] = 0;

  for (const row of state.board) {
    for (const stack of row) {
      const top = stack[stack.length - 1] ?? null;
      if (top) counts[top] = (counts[top] ?? 0) + 1;
    }
  }

  return counts;
}

function canAppendPath(source: Coord | null, path: Coord[], target: Coord) {
  if (!source) return false;
  const current = path.length === 0 ? source : path[path.length - 1];
  if (!inBoard(target.row, target.col) || !adjacent(current, target)) return false;
  if (path.length > 0) {
    const previous = path.length === 1 ? source : path[path.length - 2];
    if (sameCoord(target, previous)) {
      return false;
    }
  }
  return true;
}

export function Component(props: GameComponentProps) {
  const { currentPlayer, activePlayer, disabled, onAction } = props;
  const publicState = props.publicState as QawalePublicState;
  const [source, setSource] = useState<Coord | null>(null);
  const [path, setPath] = useState<Coord[]>([]);
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const canAct =
    !disabled &&
    publicState.phase === "playing" &&
    !publicState.winnerId &&
    currentPlayer?.id === activePlayer?.id &&
    Boolean(currentModulePlayer);
  const carryLength = source ? publicState.board[source.row][source.col].length + 1 : 0;
  const carryStones = source && currentModulePlayer ? [...publicState.board[source.row][source.col], currentModulePlayer.id] : [];
  const pathComplete = source && path.length === carryLength;
  const topCounts = useMemo(() => visibleTopCounts(publicState), [publicState]);
  const pathStepsByCell = useMemo(() => {
    const steps = new Map<string, number[]>();
    path.forEach((coord, index) => {
      const cellKey = key(coord.row, coord.col);
      steps.set(cellKey, [...(steps.get(cellKey) ?? []), index + 1]);
    });
    return steps;
  }, [path]);
  const nextTargets = useMemo(() => {
    if (!source || pathComplete) return new Set<string>();
    return new Set(
      neighbors(path.length === 0 ? source : path[path.length - 1])
        .filter((candidate) => canAppendPath(source, path, candidate))
        .map((candidate) => key(candidate.row, candidate.col))
    );
  }, [source, path, pathComplete]);
  const routeHint = !canAct
    ? "현재 차례가 아니면 경로를 선택할 수 없습니다."
    : !source
      ? "높이가 1 이상인 스택을 먼저 고르세요."
      : pathComplete
        ? "필요한 칸을 모두 골랐습니다. 분배를 눌러 확정하세요."
        : nextTargets.size > 0
          ? `밝게 표시된 다음 칸 ${nextTargets.size}곳 중 하나를 고르세요.`
          : "이어갈 수 있는 칸이 없습니다. 취소하고 다른 경로를 선택하세요.";

  function selectCell(row: number, col: number) {
    if (!canAct) return;
    const coord = { row, col };

    if (!source) {
      if (publicState.board[row][col].length === 0) return;
      setSource(coord);
      setPath([]);
      return;
    }

    if (pathComplete) return;
    if (canAppendPath(source, path, coord)) {
      setPath([...path, coord]);
    }
  }

  function resetPath() {
    setSource(null);
    setPath([]);
  }

  function submitMove() {
    if (!canAct || !source || !pathComplete) return;
    onAction({ type: "distribute", payload: { source, path } });
    resetPath();
  }

  return (
    <div className="qaw-shell">
      <style>{qawaleStyles}</style>
      <div className="qaw-status">
        <div>
          <strong>{publicState.phase === "complete" ? (publicState.winnerId ? "승자" : "무승부") : "차례"}</strong>
          <span>
            {publicState.winnerId
              ? playerName(publicState, publicState.winnerId)
              : publicState.phase === "complete"
                ? "승자 없음"
                : activeModulePlayer?.name ?? "대기"}
          </span>
        </div>
        <p>{publicState.message}</p>
      </div>

      <div className="qaw-layout">
        <div className="qaw-board" aria-label="카왈레 보드">
          {publicState.board.map((row, rowIndex) =>
            row.map((stack, colIndex) => {
              const top = stack[stack.length - 1] ?? null;
              const cellKey = key(rowIndex, colIndex);
              const selected = source?.row === rowIndex && source.col === colIndex;
              const pathSteps = pathStepsByCell.get(cellKey) ?? [];
              const inPath = pathSteps.length > 0;
              const next = nextTargets.has(cellKey);
              const sourceCandidate = canAct && !source && stack.length > 0;
              const invalidTarget = Boolean(source && !pathComplete && !next && !selected && !inPath);
              return (
                <button
                  className={`qaw-cell ${selected ? "selected" : ""} ${sourceCandidate ? "source-candidate" : ""} ${
                    inPath ? "path" : ""
                  } ${next ? "next" : ""} ${invalidTarget ? "invalid-target" : ""}`}
                  disabled={!canAct || (!source && stack.length === 0) || invalidTarget || Boolean(source && pathComplete)}
                  key={cellKey}
                  onClick={() => selectCell(rowIndex, colIndex)}
                  title={
                    selected
                      ? "출발 스택"
                      : inPath
                        ? "이미 선택한 경로"
                        : next
                          ? "다음 분배 후보"
                          : stack.length > 0
                            ? `스택 높이 ${stack.length}`
                            : "빈 칸"
                  }
                  type="button"
                >
                  <span className="qaw-stack" aria-hidden={stack.length === 0}>
                    {stack.length === 0 ? (
                      <span className="qaw-empty-dot" />
                    ) : (
                      stack.map((stone, stoneIndex) => {
                        const depth = stack.length - 1 - stoneIndex;
                        return (
                          <span
                            className={`qaw-layer ${stoneIndex === stack.length - 1 ? "top" : ""}`}
                            key={`${stone}-${stoneIndex}`}
                            style={
                              {
                                "--stone-color": stoneColor(publicState, stone),
                                "--stone-offset-x": `${depth * 2}px`,
                                "--stone-offset-y": `${depth * 5}px`,
                                color: stone === NEUTRAL ? "#17201d" : "white"
                              } as CSSProperties
                            }
                          >
                            {stoneIndex === stack.length - 1 ? <span>{stoneLabel(publicState, top)}</span> : ""}
                          </span>
                        );
                      })
                    )}
                  </span>
                  <span className="qaw-height">{stack.length}</span>
                  <span
                    className="qaw-top-owner"
                    style={
                      {
                        "--stone-color": stoneColor(publicState, top),
                        color: top && top !== NEUTRAL ? "white" : "#17201d"
                      } as CSSProperties
                    }
                  >
                    {top ? stoneLabel(publicState, top) : "-"}
                  </span>
                  {sourceCandidate || selected || inPath || next ? (
                    <span className="qaw-cell-cue">
                      {selected
                        ? `출발 +1`
                        : inPath
                          ? pathSteps.join("/")
                          : next
                            ? `${path.length + 1}`
                            : "올림"}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <aside className="qaw-panel">
          <div className="qaw-players">
            {publicState.players.map((player) => (
              <div className="qaw-player" key={player.id}>
                <span className="qaw-swatch" style={{ background: player.color }} />
                <div>
                  <strong>{player.name}</strong>
                  <span>
                    남은 돌 {publicState.reserves[player.id] ?? 0}개 · 윗면 {topCounts[player.id] ?? 0}개
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="qaw-top-summary" aria-label="윗면 현황">
            <strong>윗면 현황</strong>
            <div>
              {publicState.players.map((player) => (
                <span key={player.id}>
                  <i style={{ "--stone-color": player.color } as CSSProperties} />
                  {topCounts[player.id] ?? 0}
                </span>
              ))}
              <span>
                <i style={{ "--stone-color": stoneColor(publicState, NEUTRAL) } as CSSProperties} />
                {topCounts[NEUTRAL] ?? 0}
              </span>
            </div>
          </div>

          <div className="qaw-route">
            <strong>분배 경로</strong>
            <span>
              {source
                ? `${source.row + 1}-${source.col + 1}에서 ${path.length}/${carryLength}칸 선택`
                : "비어 있지 않은 출발 스택을 고르세요"}
            </span>
            <p className="qaw-route-hint">{routeHint}</p>
            <div className="qaw-carry-preview">
              <span>
                {source && currentModulePlayer
                  ? `기존 ${carryLength - 1}개 + 내 돌 1개 = ${carryLength}개`
                  : "출발 스택을 고르면 분배 순서가 표시됩니다"}
              </span>
              <div>
                {carryStones.map((stone, index) => (
                  <i
                    key={`${stone}-${index}`}
                    style={
                      {
                        "--stone-color": stoneColor(publicState, stone),
                        color: stone !== NEUTRAL ? "white" : "#17201d"
                      } as CSSProperties
                    }
                    title={`${index + 1}번째: ${stoneName(publicState, stone)}`}
                  >
                    {index + 1}
                  </i>
                ))}
              </div>
            </div>
            <div className="qaw-route-list">
              {path.map((coord, index) => (
                <span key={`${index}-${key(coord.row, coord.col)}`}>{`${coord.row + 1}-${coord.col + 1}`}</span>
              ))}
            </div>
            <div className="qaw-actions">
              <button disabled={!source} onClick={resetPath} type="button">
                취소
              </button>
              <button disabled={!canAct || !pathComplete} onClick={submitMove} type="button">
                분배
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const qawaleStyles = `
.qaw-shell {
  display: grid;
  gap: 14px;
  color: #17201d;
  min-width: 0;
}
.qaw-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  border: 1px solid rgba(24, 24, 24, 0.18);
  border-radius: 8px;
  padding: 12px;
  background:
    linear-gradient(180deg, #f7f1e6, #e6d4b5);
}
.qaw-status strong,
.qaw-status span {
  display: block;
}
.qaw-status span,
.qaw-status p {
  color: #52625d;
}
.qaw-status p {
  flex: 1 1 220px;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.qaw-layout {
  display: grid;
  grid-template-columns: minmax(240px, 420px) minmax(180px, 1fr);
  gap: 16px;
  align-items: start;
  min-width: 0;
}
.qaw-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(44px, 1fr));
  gap: 10px;
  width: min(100%, 420px);
  aspect-ratio: 1;
  padding: 16px;
  border: 1px solid rgba(12, 12, 12, 0.52);
  border-radius: 8px;
  background:
    radial-gradient(circle at 25% 20%, rgba(255, 255, 255, 0.12), transparent 24%),
    linear-gradient(145deg, #2b2b2a, #0f1112);
  box-shadow:
    inset 0 0 0 5px rgba(255, 255, 255, 0.08),
    inset 0 0 20px rgba(0, 0, 0, 0.42),
    0 14px 24px rgba(12, 12, 12, 0.18);
}
.qaw-cell {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background:
    radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.08), transparent 58%),
    #181b1c;
  color: #f9f3e6;
  box-shadow: inset 0 4px 10px rgba(0, 0, 0, 0.42);
}
.qaw-cell.selected {
  outline: 3px solid #e5c55c;
  outline-offset: 1px;
}
.qaw-cell.source-candidate {
  box-shadow:
    inset 0 0 0 2px rgba(229, 197, 92, 0.56),
    inset 0 4px 10px rgba(0, 0, 0, 0.42);
}
.qaw-cell.path {
  background:
    radial-gradient(circle at 50% 42%, rgba(229, 197, 92, 0.26), transparent 62%),
    #222425;
}
.qaw-cell.next {
  box-shadow:
    inset 0 0 0 3px #e5c55c,
    inset 0 4px 10px rgba(0, 0, 0, 0.42);
}
.qaw-cell.invalid-target {
  opacity: 0.48;
}
.qaw-stack {
  position: relative;
  display: block;
  width: 64%;
  aspect-ratio: 1;
}
.qaw-empty-dot {
  position: absolute;
  inset: 34%;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}
.qaw-layer {
  position: absolute;
  left: 50%;
  top: 50%;
  display: grid;
  place-items: center;
  width: 76%;
  aspect-ratio: 1;
  border: 2px solid rgba(15, 15, 15, 0.28);
  border-radius: 999px;
  background:
    radial-gradient(circle at 33% 25%, rgba(255, 255, 255, 0.55), transparent 22%),
    var(--stone-color);
  font-weight: 900;
  transform: translate(calc(-50% - var(--stone-offset-x)), calc(-50% + var(--stone-offset-y)));
  box-shadow:
    inset 0 8px 10px rgba(255, 255, 255, 0.24),
    inset 0 -8px 10px rgba(0, 0, 0, 0.22),
    0 4px 7px rgba(0, 0, 0, 0.32);
}
.qaw-layer > span {
  display: grid;
  place-items: center;
  width: 58%;
  aspect-ratio: 1;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.14);
  font-size: 0.8rem;
  line-height: 1;
}
.qaw-layer.top {
  z-index: 12;
}
.qaw-height {
  position: absolute;
  right: 7px;
  bottom: 5px;
  color: #e8dcc4;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 0.8rem;
  font-weight: 800;
}
.qaw-top-owner {
  position: absolute;
  left: 6px;
  top: 5px;
  z-index: 20;
  display: grid;
  place-items: center;
  min-width: 21px;
  height: 21px;
  border: 1px solid rgba(255, 255, 255, 0.54);
  border-radius: 999px;
  background:
    radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.58), transparent 28%),
    var(--stone-color);
  color: #17201d;
  font-size: 0.72rem;
  font-weight: 950;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.32);
}
.qaw-cell-cue {
  position: absolute;
  left: 50%;
  bottom: 6px;
  z-index: 22;
  display: inline-grid;
  place-items: center;
  min-width: 34px;
  min-height: 22px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 999px;
  padding: 0 7px;
  background: rgba(229, 197, 92, 0.95);
  color: #2b1b10;
  font-size: 0.72rem;
  font-weight: 950;
  line-height: 1;
  transform: translateX(-50%);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.28);
}
.qaw-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.qaw-players {
  display: grid;
  gap: 8px;
}
.qaw-player {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 9px;
  background: linear-gradient(180deg, #fffaf0, #eadabe);
}
.qaw-player strong,
.qaw-player span {
  display: block;
}
.qaw-player span {
  color: #52625d;
  font-size: 0.84rem;
}
.qaw-swatch {
  width: 18px;
  height: 18px;
  border-radius: 999px;
}
.qaw-top-summary {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 10px;
  background: linear-gradient(180deg, #fffaf0, #eadabe);
}
.qaw-top-summary > div {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.qaw-top-summary span {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  border: 1px solid rgba(23, 32, 29, 0.12);
  border-radius: 8px;
  background: rgba(255, 250, 240, 0.78);
  color: #17201d;
  font-weight: 950;
}
.qaw-top-summary i,
.qaw-carry-preview i {
  display: inline-grid;
  place-items: center;
  width: 20px;
  aspect-ratio: 1;
  border: 1px solid rgba(23, 32, 29, 0.2);
  border-radius: 999px;
  background:
    radial-gradient(circle at 30% 22%, rgba(255, 255, 255, 0.62), transparent 28%),
    var(--stone-color);
  color: #17201d;
  font-style: normal;
  font-size: 0.68rem;
  font-weight: 950;
  box-shadow:
    inset 0 -3px 5px rgba(0, 0, 0, 0.18),
    0 2px 4px rgba(0, 0, 0, 0.18);
}
.qaw-route {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 10px;
  background: linear-gradient(180deg, #fffaf0, #eadabe);
}
.qaw-route > span {
  color: #52625d;
}
.qaw-route-hint {
  margin: -2px 0 0;
  border: 1px solid rgba(23, 32, 29, 0.12);
  border-radius: 8px;
  padding: 8px;
  background: rgba(255, 250, 240, 0.72);
  color: #4f4639;
  font-size: 0.86rem;
  line-height: 1.4;
}
.qaw-carry-preview {
  display: grid;
  gap: 7px;
  border: 1px solid rgba(23, 32, 29, 0.12);
  border-radius: 8px;
  padding: 8px;
  background: rgba(255, 250, 240, 0.72);
}
.qaw-carry-preview > span {
  color: #52625d;
  font-size: 0.82rem;
  font-weight: 800;
}
.qaw-carry-preview > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 22px;
}
.qaw-carry-preview i {
  width: 24px;
}
.qaw-route-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 30px;
}
.qaw-route-list span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 0 8px;
  background: #f4e5c6;
  font-size: 0.84rem;
  font-weight: 800;
}
.qaw-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.qaw-actions button {
  border: 1px solid rgba(24, 24, 24, 0.2);
  border-radius: 8px;
  background: linear-gradient(180deg, #fff4d6, #d9b574);
  color: #17201d;
}
.qaw-actions button:last-child {
  color: white;
  background: linear-gradient(180deg, #333333, #111111);
}
@media (max-width: 760px) {
  .qaw-layout {
    grid-template-columns: 1fr;
  }
}
`;
