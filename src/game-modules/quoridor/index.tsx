import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const BOARD_SIZE = 9;
const WALL_GRID = 8;

type Orientation = "horizontal" | "vertical";
type Goal = "top" | "bottom" | "left" | "right";

interface QuoridorPlayer {
  id: string;
  name: string;
  seat: number;
  row: number;
  col: number;
  goal: Goal;
  wallsRemaining: number;
  color: string;
}

interface QuoridorState {
  players: QuoridorPlayer[];
  walls: {
    horizontal: string[];
    vertical: string[];
  };
  winnerId: string | null;
  message: string;
}

type QuoridorPublicState = QuoridorState;

interface Coord {
  row: number;
  col: number;
}

interface WallPayload {
  orientation: Orientation;
  row: number;
  col: number;
}

const playerColors = ["#111827", "#f8fafc", "#b94f45", "#2364aa"];

function key(row: number, col: number) {
  return `${row},${col}`;
}

function coordFromKey(value: string): Coord {
  const [row = "0", col = "0"] = value.split(",");
  return { row: Number(row), col: Number(col) };
}

function isCoord(value: unknown): value is Coord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.row) && Number.isInteger(item.col);
}

function isWallPayload(value: unknown): value is WallPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    (item.orientation === "horizontal" || item.orientation === "vertical") &&
    Number.isInteger(item.row) &&
    Number.isInteger(item.col)
  );
}

function inBoard(row: number, col: number) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function inWallGrid(row: number, col: number) {
  return row >= 0 && row < WALL_GRID && col >= 0 && col < WALL_GRID;
}

function cloneState(state: QuoridorState): QuoridorState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    walls: {
      horizontal: [...state.walls.horizontal],
      vertical: [...state.walls.vertical]
    }
  };
}

function setupForPlayer(index: number, playerCount: number) {
  const twoPlayerSetup = [
    { row: 8, col: 4, goal: "top" as const },
    { row: 0, col: 4, goal: "bottom" as const }
  ];
  const fourPlayerSetup = [
    { row: 8, col: 4, goal: "top" as const },
    { row: 0, col: 4, goal: "bottom" as const },
    { row: 4, col: 0, goal: "right" as const },
    { row: 4, col: 8, goal: "left" as const }
  ];
  return (playerCount === 4 ? fourPlayerSetup : twoPlayerSetup)[index];
}

function reachesGoal(player: QuoridorPlayer, row = player.row, col = player.col) {
  if (player.goal === "top") return row === 0;
  if (player.goal === "bottom") return row === BOARD_SIZE - 1;
  if (player.goal === "left") return col === 0;
  return col === BOARD_SIZE - 1;
}

function hasWall(state: QuoridorState, orientation: Orientation, row: number, col: number) {
  return state.walls[orientation].includes(key(row, col));
}

function wallBlocksMove(state: QuoridorState, from: Coord, to: Coord) {
  const dr = to.row - from.row;
  const dc = to.col - from.col;

  if (Math.abs(dr) + Math.abs(dc) !== 1) return true;

  if (dr === 1) {
    const wallRow = from.row;
    return hasWall(state, "horizontal", wallRow, from.col) || hasWall(state, "horizontal", wallRow, from.col - 1);
  }
  if (dr === -1) {
    const wallRow = to.row;
    return hasWall(state, "horizontal", wallRow, from.col) || hasWall(state, "horizontal", wallRow, from.col - 1);
  }
  if (dc === 1) {
    const wallCol = from.col;
    return hasWall(state, "vertical", from.row, wallCol) || hasWall(state, "vertical", from.row - 1, wallCol);
  }

  const wallCol = to.col;
  return hasWall(state, "vertical", from.row, wallCol) || hasWall(state, "vertical", from.row - 1, wallCol);
}

function occupiedByOther(state: QuoridorState, row: number, col: number, playerId: string) {
  return state.players.some((player) => player.id !== playerId && player.row === row && player.col === col);
}

function pawnAt(state: QuoridorState, row: number, col: number, exceptPlayerId: string) {
  return state.players.find((player) => player.id !== exceptPlayerId && player.row === row && player.col === col) ?? null;
}

function legalPawnMoves(state: QuoridorState, player: QuoridorPlayer) {
  const deltas = [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 }
  ];

  const moves: Coord[] = [];
  const seen = new Set<string>();
  const addMove = (target: Coord) => {
    const moveKey = key(target.row, target.col);
    if (!seen.has(moveKey)) {
      seen.add(moveKey);
      moves.push(target);
    }
  };

  for (const delta of deltas) {
    const adjacent = { row: player.row + delta.row, col: player.col + delta.col };
    if (!inBoard(adjacent.row, adjacent.col) || wallBlocksMove(state, player, adjacent)) {
      continue;
    }

    const adjacentPawn = pawnAt(state, adjacent.row, adjacent.col, player.id);
    if (!adjacentPawn) {
      addMove(adjacent);
      continue;
    }

    const jumpTarget = { row: adjacent.row + delta.row, col: adjacent.col + delta.col };
    const canJumpStraight =
      inBoard(jumpTarget.row, jumpTarget.col) &&
      !wallBlocksMove(state, adjacent, jumpTarget) &&
      !occupiedByOther(state, jumpTarget.row, jumpTarget.col, player.id);

    if (canJumpStraight) {
      addMove(jumpTarget);
      continue;
    }

    const diagonalDeltas =
      delta.row !== 0
        ? [
            { row: 0, col: -1 },
            { row: 0, col: 1 }
          ]
        : [
            { row: -1, col: 0 },
            { row: 1, col: 0 }
          ];

    for (const diagonalDelta of diagonalDeltas) {
      const diagonalTarget = {
        row: adjacent.row + diagonalDelta.row,
        col: adjacent.col + diagonalDelta.col
      };
      if (
        inBoard(diagonalTarget.row, diagonalTarget.col) &&
        !wallBlocksMove(state, adjacent, diagonalTarget) &&
        !occupiedByOther(state, diagonalTarget.row, diagonalTarget.col, player.id)
      ) {
        addMove(diagonalTarget);
      }
    }
  }

  return moves;
}

function wallWouldOverlap(state: QuoridorState, orientation: Orientation, row: number, col: number) {
  if (!inWallGrid(row, col)) return true;
  const wallKey = key(row, col);
  if (state.walls.horizontal.includes(wallKey) || state.walls.vertical.includes(wallKey)) {
    return true;
  }
  if (orientation === "horizontal") {
    return state.walls.horizontal.includes(key(row, col - 1)) || state.walls.horizontal.includes(key(row, col + 1));
  }
  return state.walls.vertical.includes(key(row - 1, col)) || state.walls.vertical.includes(key(row + 1, col));
}

function stateWithWall(state: QuoridorState, orientation: Orientation, row: number, col: number) {
  const next = cloneState(state);
  next.walls[orientation].push(key(row, col));
  return next;
}

function hasPathToGoal(state: QuoridorState, player: QuoridorPlayer) {
  const queue: Coord[] = [{ row: player.row, col: player.col }];
  const visited = new Set([key(player.row, player.col)]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (reachesGoal(player, current.row, current.col)) {
      return true;
    }

    for (const next of [
      { row: current.row - 1, col: current.col },
      { row: current.row + 1, col: current.col },
      { row: current.row, col: current.col - 1 },
      { row: current.row, col: current.col + 1 }
    ]) {
      const nextKey = key(next.row, next.col);
      if (inBoard(next.row, next.col) && !visited.has(nextKey) && !wallBlocksMove(state, current, next)) {
        visited.add(nextKey);
        queue.push(next);
      }
    }
  }

  return false;
}

function wallPreservesPaths(state: QuoridorState, orientation: Orientation, row: number, col: number) {
  const next = stateWithWall(state, orientation, row, col);
  return next.players.every((player) => hasPathToGoal(next, player));
}

function connectedModulePlayers(state: QuoridorState, context: GameContext) {
  return state.players.filter((player) =>
    context.players.some((candidate) => candidate.id === player.id && candidate.connected)
  );
}

function advanceTurn(state: QuoridorState, context: GameContext) {
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

function requireActivePlayer(state: QuoridorState, context: GameContext) {
  if (state.winnerId) {
    throw new Error("이미 종료된 게임입니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("쿼리도 플레이어를 찾을 수 없습니다.");
  }
  return player;
}

function createInitialState(context: Pick<GameContext, "players">): QuoridorState {
  const seatedPlayers = context.players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, context.players.length >= 4 ? 4 : 2);
  const wallCount = seatedPlayers.length === 4 ? 5 : 10;

  return {
    players: seatedPlayers.map((player, index) => {
      const setup = setupForPlayer(index, seatedPlayers.length);
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        row: setup.row,
        col: setup.col,
        goal: setup.goal,
        wallsRemaining: wallCount,
        color: playerColors[index]
      };
    }),
    walls: {
      horizontal: [],
      vertical: []
    },
    winnerId: null,
    message: "말을 움직이거나 벽 하나를 놓으세요."
  };
}

function movePawn(state: QuoridorState, action: GameAction, context: GameContext): GameActionResult {
  if (!isCoord(action.payload)) {
    throw new Error("말을 이동할 목표 칸이 필요합니다.");
  }

  const player = requireActivePlayer(state, context);
  const target = action.payload;
  if (!legalPawnMoves(state, player).some((move) => move.row === target.row && move.col === target.col)) {
    throw new Error("그 칸으로는 이동할 수 없습니다.");
  }

  const next = cloneState(state);
  const nextPlayer = next.players.find((candidate) => candidate.id === player.id);
  if (!nextPlayer) {
    throw new Error("쿼리도 플레이어를 찾을 수 없습니다.");
  }

  nextPlayer.row = target.row;
  nextPlayer.col = target.col;

  if (reachesGoal(nextPlayer)) {
    next.winnerId = nextPlayer.id;
    next.message = `${nextPlayer.name}님이 목표 줄에 도착했습니다.`;
    return {
      state: next,
      log: `${nextPlayer.name} 목표 줄 도착 승리`,
      activePlayerId: null,
      winnerId: nextPlayer.id,
      message: next.message
    };
  }

  next.message = `${nextPlayer.name}님이 ${target.row + 1}-${target.col + 1}칸으로 이동했습니다.`;
  return {
    state: next,
    log: `${nextPlayer.name} 말 이동`,
    message: next.message,
    ...advanceTurn(next, context)
  };
}

function placeWall(state: QuoridorState, action: GameAction, context: GameContext): GameActionResult {
  if (!isWallPayload(action.payload)) {
    throw new Error("벽 방향과 위치가 필요합니다.");
  }

  const player = requireActivePlayer(state, context);
  const { orientation, row, col } = action.payload;

  if (player.wallsRemaining <= 0) {
    throw new Error("남은 벽이 없습니다.");
  }
  if (wallWouldOverlap(state, orientation, row, col)) {
    throw new Error("이미 벽이 있거나 교차되는 위치입니다.");
  }
  if (!wallPreservesPaths(state, orientation, row, col)) {
    throw new Error("모든 플레이어에게 목표까지 가는 길이 최소 1개는 남아야 합니다.");
  }

  const next = stateWithWall(state, orientation, row, col);
  const nextPlayer = next.players.find((candidate) => candidate.id === player.id);
  if (!nextPlayer) {
    throw new Error("쿼리도 플레이어를 찾을 수 없습니다.");
  }
  nextPlayer.wallsRemaining -= 1;
  next.message = `${nextPlayer.name}님이 ${orientation === "horizontal" ? "가로" : "세로"} 벽을 놓았습니다.`;

  return {
    state: next,
    log: `${nextPlayer.name} ${orientation === "horizontal" ? "가로" : "세로"} 벽 배치`,
    message: next.message,
    ...advanceTurn(next, context)
  };
}

export const module: GameModule = {
  id: "quoridor",
  createInitialState,
  getPublicState: (state) => state as QuoridorPublicState,
  applyAction: (state, action, context) => {
    const quoridorState = state as QuoridorState;
    if (action.type === "movePawn") {
      return movePawn(quoridorState, action, context);
    }
    if (action.type === "placeWall") {
      return placeWall(quoridorState, action, context);
    }
    throw new Error("지원하지 않는 쿼리도 행동입니다.");
  }
};

function goalLabel(goal: Goal) {
  if (goal === "top") return "위쪽 끝줄";
  if (goal === "bottom") return "아래쪽 끝줄";
  if (goal === "left") return "왼쪽 끝줄";
  return "오른쪽 끝줄";
}

function cellWallStyle(state: QuoridorPublicState, row: number, col: number): CSSProperties {
  const style: CSSProperties = {};
  if (row > 0 && wallBlocksMove(state, { row, col }, { row: row - 1, col })) style.borderTopColor = "#7c4a24";
  if (row < BOARD_SIZE - 1 && wallBlocksMove(state, { row, col }, { row: row + 1, col })) style.borderBottomColor = "#7c4a24";
  if (col > 0 && wallBlocksMove(state, { row, col }, { row, col: col - 1 })) style.borderLeftColor = "#7c4a24";
  if (col < BOARD_SIZE - 1 && wallBlocksMove(state, { row, col }, { row, col: col + 1 })) style.borderRightColor = "#7c4a24";
  return style;
}

function isDark(color: string) {
  return color !== "#f8fafc";
}

function wallPieceStyle(row: number, col: number): CSSProperties {
  return { "--wall-row": row, "--wall-col": col } as CSSProperties;
}

export function Component(props: GameComponentProps) {
  const { currentPlayer, activePlayer, disabled, onAction } = props;
  const publicState = props.publicState as QuoridorPublicState;
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [wallRow, setWallRow] = useState(0);
  const [wallCol, setWallCol] = useState(0);
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const canAct = !disabled && !publicState.winnerId && currentPlayer?.id === activePlayer?.id && Boolean(currentModulePlayer);
  const moves = useMemo(() => (activeModulePlayer ? legalPawnMoves(publicState, activeModulePlayer) : []), [
    activeModulePlayer,
    publicState
  ]);
  const legalMoveKeys = new Set(moves.map((move) => key(move.row, move.col)));
  const selectedWallBlocked =
    !currentModulePlayer ||
    currentModulePlayer.wallsRemaining <= 0 ||
    wallWouldOverlap(publicState, orientation, wallRow, wallCol) ||
    !wallPreservesPaths(publicState, orientation, wallRow, wallCol);
  const selectedWallReason = !currentModulePlayer
    ? "플레이어 정보를 찾을 수 없습니다."
    : currentModulePlayer.wallsRemaining <= 0
      ? "남은 벽이 없습니다."
      : wallWouldOverlap(publicState, orientation, wallRow, wallCol)
        ? "이미 벽이 있거나 교차되는 위치입니다."
        : !wallPreservesPaths(publicState, orientation, wallRow, wallCol)
          ? "누군가의 길을 완전히 막는 위치입니다."
          : "놓을 수 있는 벽 위치입니다.";

  function sendPawnMove(row: number, col: number) {
    if (!canAct || !legalMoveKeys.has(key(row, col))) return;
    onAction({ type: "movePawn", payload: { row, col } });
  }

  function sendWall() {
    if (!canAct || selectedWallBlocked) return;
    onAction({ type: "placeWall", payload: { orientation, row: wallRow, col: wallCol } });
  }

  return (
    <div className="qdr-shell">
      <style>{quoridorStyles}</style>
      <div className="qdr-status">
        <div>
          <strong>{publicState.winnerId ? "승자" : "차례"}</strong>
          <span>
            {publicState.winnerId
              ? publicState.players.find((player) => player.id === publicState.winnerId)?.name
              : activeModulePlayer?.name ?? "대기"}
          </span>
        </div>
        <p>{publicState.message}</p>
      </div>

      <div className="qdr-layout">
        <div className="qdr-board" aria-label="쿼리도 보드">
          {Array.from({ length: BOARD_SIZE }, (_, row) =>
            Array.from({ length: BOARD_SIZE }, (_, col) => {
              const pawn = publicState.players.find((player) => player.row === row && player.col === col);
              const legal = canAct && legalMoveKeys.has(key(row, col));
              return (
                <button
                  className={`qdr-cell ${legal ? "legal" : ""}`}
                  disabled={!legal}
                  key={key(row, col)}
                  onClick={() => sendPawnMove(row, col)}
                  style={cellWallStyle(publicState, row, col)}
                  type="button"
                  title={`${row + 1}행 ${col + 1}열`}
                >
                  {pawn ? (
                    <span
                      className="qdr-pawn"
                      style={{
                        background: pawn.color,
                        color: isDark(pawn.color) ? "white" : "#111827"
                      }}
                    >
                      {pawn.seat}
                    </span>
                  ) : legal ? (
                    <span className="qdr-dot" />
                  ) : null}
                </button>
              );
            })
          )}
          {publicState.walls.horizontal.map((wallKey) => {
            const wall = coordFromKey(wallKey);
            return (
              <span
                aria-hidden="true"
                className="qdr-wall-piece horizontal"
                key={`h-${wallKey}`}
                style={wallPieceStyle(wall.row, wall.col)}
              />
            );
          })}
          {publicState.walls.vertical.map((wallKey) => {
            const wall = coordFromKey(wallKey);
            return (
              <span
                aria-hidden="true"
                className="qdr-wall-piece vertical"
                key={`v-${wallKey}`}
                style={wallPieceStyle(wall.row, wall.col)}
              />
            );
          })}
        </div>

        <aside className="qdr-panel">
          <div className="qdr-players">
            {publicState.players.map((player) => (
              <div className="qdr-player" key={player.id}>
                <span className="qdr-swatch" style={{ background: player.color }} />
                <div>
                  <strong>{player.name}</strong>
                  <span>
                    남은 벽 {player.wallsRemaining}개 · 목표 {goalLabel(player.goal)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="qdr-wall-controls">
            <strong>벽 놓기</strong>
            <div className="qdr-segment">
              <button
                className={orientation === "horizontal" ? "active" : ""}
                disabled={!canAct}
                onClick={() => setOrientation("horizontal")}
                type="button"
              >
                가로
              </button>
              <button
                className={orientation === "vertical" ? "active" : ""}
                disabled={!canAct}
                onClick={() => setOrientation("vertical")}
                type="button"
              >
                세로
              </button>
            </div>
            <div className="qdr-wall-grid">
              {Array.from({ length: WALL_GRID }, (_, row) =>
                Array.from({ length: WALL_GRID }, (_, col) => {
                  const selected = row === wallRow && col === wallCol;
                  const blocked =
                    wallWouldOverlap(publicState, orientation, row, col) ||
                    !wallPreservesPaths(publicState, orientation, row, col);
                  return (
                    <button
                      className={`${selected ? "selected" : ""} ${blocked ? "blocked" : ""}`}
                      disabled={!canAct}
                      key={key(row, col)}
                      onClick={() => {
                        setWallRow(row);
                        setWallCol(col);
                      }}
                      type="button"
                    >
                      {orientation === "horizontal" ? "가" : "세"}
                    </button>
                  );
                })
              )}
            </div>
            <span className={selectedWallBlocked ? "qdr-wall-hint blocked" : "qdr-wall-hint"}>
              {selectedWallReason}
            </span>
            <button className="qdr-action" disabled={!canAct || selectedWallBlocked} onClick={sendWall} type="button">
              {wallRow + 1}-{wallCol + 1}에 벽 놓기
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

const quoridorStyles = `
.qdr-shell {
  display: grid;
  gap: 14px;
  color: #251915;
  background:
    radial-gradient(circle at 18% 10%, rgba(255, 225, 146, 0.16), transparent 24%),
    linear-gradient(135deg, #7b2f25, #3b1e1a 54%, #1f1716);
  border-radius: 8px;
  padding: 12px;
}
.qdr-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(255, 218, 135, 0.28);
  border-radius: 8px;
  padding: 12px;
  background:
    linear-gradient(180deg, rgba(255, 236, 179, 0.92), rgba(201, 124, 66, 0.54)),
    #ffecd0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.26);
}
.qdr-status strong,
.qdr-status span {
  display: block;
}
.qdr-status span,
.qdr-status p {
  color: #52625d;
}
.qdr-status p {
  margin: 0;
}
.qdr-layout {
  display: grid;
  grid-template-columns: minmax(420px, 1fr) 236px;
  gap: 16px;
  align-items: start;
  min-width: 0;
}
.qdr-board {
  --qdr-padding: 18px;
  --qdr-gap: 6px;
  --qdr-cell: calc((100% - (var(--qdr-padding) * 2) - (var(--qdr-gap) * 8)) / 9);
  position: relative;
  display: grid;
  grid-template-columns: repeat(9, minmax(44px, 1fr));
  gap: var(--qdr-gap);
  width: min(100%, 560px);
  min-width: 450px;
  aspect-ratio: 1;
  margin: 0 auto;
  padding: var(--qdr-padding);
  border: 10px solid #7c2f25;
  border-radius: 10px;
  background:
    linear-gradient(90deg, #201513 0 6px, transparent 6px),
    linear-gradient(0deg, #201513 0 6px, transparent 6px),
    linear-gradient(135deg, #8e3b2e, #4a211c 62%, #221616);
  box-shadow:
    inset 0 0 0 3px rgba(255, 199, 89, 0.18),
    inset 0 0 32px rgba(0, 0, 0, 0.34),
    0 18px 28px rgba(35, 17, 12, 0.34);
}
.qdr-cell {
  display: grid;
  place-items: center;
  min-height: 0;
  aspect-ratio: 1;
  border: 1px solid rgba(255, 202, 99, 0.18);
  border-radius: 5px;
  background:
    radial-gradient(circle at 36% 22%, rgba(255, 230, 171, 0.3), transparent 34%),
    linear-gradient(180deg, #5b3029, #2d1c1a);
  color: #ffe3a0;
  padding: 0;
  box-shadow:
    inset 0 1px 0 rgba(255, 215, 139, 0.18),
    inset 0 -4px 0 rgba(0, 0, 0, 0.24);
}
.qdr-cell.legal {
  background:
    radial-gradient(circle at center, rgba(248, 211, 92, 0.34), transparent 58%),
    linear-gradient(180deg, #6f3a30, #33201e);
  box-shadow:
    inset 0 0 0 3px #f7c845,
    inset 0 -4px 0 rgba(0, 0, 0, 0.24);
}
.qdr-pawn {
  display: grid;
  place-items: center;
  width: 68%;
  aspect-ratio: 1;
  border: 2px solid rgba(17, 24, 39, 0.34);
  border-radius: 999px;
  font-weight: 900;
  box-shadow:
    inset 0 7px 10px rgba(255, 255, 255, 0.32),
    inset 0 -8px 10px rgba(0, 0, 0, 0.18),
    0 5px 8px rgba(42, 24, 12, 0.32);
}
.qdr-dot {
  width: 36%;
  aspect-ratio: 1;
  border-radius: 999px;
  background: #28777c;
}
.qdr-wall-piece {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  border-radius: 999px;
  background:
    radial-gradient(circle at 28% 24%, rgba(255, 244, 205, 0.72), transparent 28%),
    linear-gradient(180deg, #f4c873, #9a5a24);
  box-shadow:
    inset 0 1px 0 rgba(255, 244, 205, 0.5),
    inset 0 -4px 0 rgba(74, 40, 17, 0.28),
    0 4px 8px rgba(54, 31, 15, 0.34);
}
.qdr-wall-piece.horizontal {
  left: calc(var(--qdr-padding) + (var(--wall-col) * (var(--qdr-cell) + var(--qdr-gap))) + (var(--qdr-cell) * 0.08));
  top: calc(var(--qdr-padding) + ((var(--wall-row) + 1) * var(--qdr-cell)) + (var(--wall-row) * var(--qdr-gap)) + (var(--qdr-gap) * 0.05));
  width: calc((var(--qdr-cell) * 1.84) + var(--qdr-gap));
  height: calc(var(--qdr-gap) * 0.9);
}
.qdr-wall-piece.vertical {
  left: calc(var(--qdr-padding) + ((var(--wall-col) + 1) * var(--qdr-cell)) + (var(--wall-col) * var(--qdr-gap)) + (var(--qdr-gap) * 0.05));
  top: calc(var(--qdr-padding) + (var(--wall-row) * (var(--qdr-cell) + var(--qdr-gap))) + (var(--qdr-cell) * 0.08));
  width: calc(var(--qdr-gap) * 0.9);
  height: calc((var(--qdr-cell) * 1.84) + var(--qdr-gap));
}
.qdr-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.qdr-players {
  display: grid;
  gap: 8px;
}
.qdr-player {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  border: 1px solid rgba(255, 218, 135, 0.24);
  border-radius: 8px;
  padding: 9px;
  background:
    linear-gradient(180deg, #ffe9b7, #d99b4f);
  box-shadow: inset 0 -3px 0 rgba(75, 42, 19, 0.16);
}
.qdr-player strong,
.qdr-player span {
  display: block;
}
.qdr-player span {
  color: #52625d;
  font-size: 0.84rem;
}
.qdr-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(23, 32, 29, 0.2);
  border-radius: 999px;
}
.qdr-wall-controls {
  display: grid;
  gap: 10px;
  min-width: 0;
  overflow-x: auto;
  border: 1px solid rgba(255, 218, 135, 0.24);
  border-radius: 8px;
  padding: 10px;
  background:
    linear-gradient(180deg, rgba(255, 229, 155, 0.96), rgba(155, 88, 43, 0.84));
}
.qdr-segment {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.qdr-segment button,
.qdr-action,
.qdr-wall-grid button {
  border: 1px solid rgba(84, 45, 20, 0.34);
  border-radius: 6px;
  background:
    linear-gradient(90deg, rgba(255, 243, 196, 0.75), transparent 28%),
    linear-gradient(180deg, #f7c45f, #c6802f);
  color: #271915;
  box-shadow:
    inset 0 -3px 0 rgba(90, 45, 16, 0.18),
    0 2px 0 rgba(42, 20, 10, 0.18);
}
.qdr-segment button.active,
.qdr-action {
  background:
    linear-gradient(180deg, #f9d36f, #9d5626);
  color: #211513;
}
.qdr-wall-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 5px;
  min-width: 360px;
}
.qdr-wall-grid button {
  min-width: 40px;
  min-height: 34px;
  padding: 0;
  color: transparent;
  font-size: 0;
}
.qdr-wall-grid button::before {
  content: "";
  display: block;
  width: 72%;
  height: 9px;
  margin: 0 auto;
  border-radius: 999px;
  background: #ffe08a;
  box-shadow:
    inset 0 -3px 0 rgba(101, 55, 22, 0.24),
    0 2px 0 rgba(0, 0, 0, 0.16);
}
.qdr-wall-grid button.selected {
  outline: 2px solid #fdf7c3;
  outline-offset: 1px;
}
.qdr-wall-grid button.blocked {
  background: #5e3a32;
}
.qdr-wall-hint {
  color: #155847;
  font-size: 0.84rem;
  line-height: 1.35;
}
.qdr-wall-hint.blocked {
  color: #8f2c25;
}
@media (max-width: 1320px) {
  .qdr-layout {
    grid-template-columns: 1fr;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .qdr-board {
    width: 450px;
    max-width: none;
  }
}
`;
