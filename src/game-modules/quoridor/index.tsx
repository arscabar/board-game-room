import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const BOARD_SIZE = 9;
const WALL_GRID = 8;

type Orientation = "horizontal" | "vertical";
type ActionMode = "move" | "wall";
type Goal = "top" | "bottom" | "left" | "right";

type PendingConfirm =
  | {
      type: "move";
      row: number;
      col: number;
    }
  | {
      type: "wall";
      orientation: Orientation;
      row: number;
      col: number;
    };

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
const skipConfirmStorageKey = "board-room-quoridor-skip-confirm";

function wallReserveSize(playerCount: number) {
  return playerCount >= 4 ? 5 : 10;
}

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

function wallTouchesOuterEdge(row: number, col: number) {
  return !inWallGrid(row, col) || row === 0 || col === 0 || row === WALL_GRID - 1 || col === WALL_GRID - 1;
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
  const wallCount = wallReserveSize(seatedPlayers.length);

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
  if (wallTouchesOuterEdge(row, col)) {
    throw new Error("가장 바깥 끝선에는 벽을 설치할 수 없습니다.");
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

function sameCoord(a: Coord | null, row: number, col: number) {
  return Boolean(a && a.row === row && a.col === col);
}

function readSkipConfirm() {
  if (typeof localStorage === "undefined") {
    return false;
  }
  return localStorage.getItem(skipConfirmStorageKey) === "1";
}

function writeSkipConfirm(value: boolean) {
  if (typeof localStorage === "undefined") {
    return;
  }
  if (value) {
    localStorage.setItem(skipConfirmStorageKey, "1");
  } else {
    localStorage.removeItem(skipConfirmStorageKey);
  }
}

function orientationLabel(orientation: Orientation) {
  return orientation === "horizontal" ? "가로" : "세로";
}

export function Component(props: GameComponentProps) {
  const { currentPlayer, activePlayer, disabled, onAction } = props;
  const publicState = props.publicState as QuoridorPublicState;
  const [mode, setMode] = useState<ActionMode>("move");
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [wallRow, setWallRow] = useState(1);
  const [wallCol, setWallCol] = useState(1);
  const [selectedMove, setSelectedMove] = useState<Coord | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(() => readSkipConfirm());
  const wallReserveTotal = wallReserveSize(publicState.players.length);
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const canAct = !disabled && !publicState.winnerId && currentPlayer?.id === activePlayer?.id && Boolean(currentModulePlayer);
  const moves = useMemo(() => (activeModulePlayer ? legalPawnMoves(publicState, activeModulePlayer) : []), [
    activeModulePlayer,
    publicState
  ]);
  const legalMoveKeys = useMemo(() => new Set(moves.map((move) => key(move.row, move.col))), [moves]);
  const selectedMoveBlocked = !selectedMove || !legalMoveKeys.has(key(selectedMove.row, selectedMove.col));
  const selectedWallBlocked =
    !currentModulePlayer ||
    currentModulePlayer.wallsRemaining <= 0 ||
    wallTouchesOuterEdge(wallRow, wallCol) ||
    wallWouldOverlap(publicState, orientation, wallRow, wallCol) ||
    !wallPreservesPaths(publicState, orientation, wallRow, wallCol);
  const selectedWallReason = !currentModulePlayer
    ? "플레이어 정보를 찾을 수 없습니다."
    : currentModulePlayer.wallsRemaining <= 0
      ? "남은 벽이 없습니다."
      : wallTouchesOuterEdge(wallRow, wallCol)
        ? "가장 바깥 끝선과 맞닿는 위치에는 벽을 놓을 수 없습니다."
        : wallWouldOverlap(publicState, orientation, wallRow, wallCol)
          ? "이미 벽이 있거나 교차되는 위치입니다."
          : !wallPreservesPaths(publicState, orientation, wallRow, wallCol)
            ? "누군가의 길을 완전히 막는 위치입니다."
            : "놓을 수 있는 벽 위치입니다.";

  function selectMode(nextMode: ActionMode) {
    setMode(nextMode);
    setPendingConfirm(null);
    if (nextMode === "move") {
      setSelectedMove(null);
    }
  }

  function selectPawnMove(row: number, col: number) {
    if (!canAct || mode !== "move" || !legalMoveKeys.has(key(row, col))) return;
    setSelectedMove({ row, col });
    setPendingConfirm(null);
  }

  function wallBlockedAt(nextOrientation: Orientation, row: number, col: number) {
    return (
      !currentModulePlayer ||
      currentModulePlayer.wallsRemaining <= 0 ||
      wallTouchesOuterEdge(row, col) ||
      wallWouldOverlap(publicState, nextOrientation, row, col) ||
      !wallPreservesPaths(publicState, nextOrientation, row, col)
    );
  }

  function previewWall(row: number, col: number) {
    setWallRow(row);
    setWallCol(col);
  }

  function selectWallAt(row: number, col: number) {
    if (!canAct || mode !== "wall") return;
    previewWall(row, col);
    setPendingConfirm(null);
  }

  function setSkipConfirmChoice(value: boolean) {
    setSkipConfirm(value);
    writeSkipConfirm(value);
  }

  function applyConfirmedAction(action: PendingConfirm) {
    if (!canAct) return;

    if (action.type === "move") {
      if (!legalMoveKeys.has(key(action.row, action.col))) {
        setPendingConfirm(null);
        return;
      }
      setSelectedMove(null);
      setPendingConfirm(null);
      onAction({ type: "movePawn", payload: { row: action.row, col: action.col } });
      return;
    }

    if (wallBlockedAt(action.orientation, action.row, action.col)) {
      setPendingConfirm(null);
      return;
    }
    setPendingConfirm(null);
    onAction({
      type: "placeWall",
      payload: { orientation: action.orientation, row: action.row, col: action.col }
    });
  }

  function requestConfirm(action: PendingConfirm) {
    if (action.type === "move" && !legalMoveKeys.has(key(action.row, action.col))) return;
    if (action.type === "wall") {
      previewWall(action.row, action.col);
      if (wallBlockedAt(action.orientation, action.row, action.col)) return;
    }
    if (skipConfirm) {
      applyConfirmedAction(action);
      return;
    }
    setPendingConfirm(action);
  }

  function confirmSelectedMove() {
    if (!selectedMove || selectedMoveBlocked) return;
    requestConfirm({ type: "move", row: selectedMove.row, col: selectedMove.col });
  }

  function sendWall() {
    if (selectedWallBlocked) return;
    requestConfirm({ type: "wall", orientation, row: wallRow, col: wallCol });
  }

  function confirmPending() {
    if (!pendingConfirm) return;
    applyConfirmedAction(pendingConfirm);
  }

  function pendingDescription(action: PendingConfirm) {
    if (action.type === "move") {
      return `${action.row + 1}행 ${action.col + 1}열로 말을 이동합니다.`;
    }
    return `${action.row + 1}행 ${action.col + 1}열에 ${orientationLabel(action.orientation)} 벽을 설치합니다.`;
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
          {activeModulePlayer ? (
            <span
              className={`qdr-goal-edge ${activeModulePlayer.goal}`}
              style={{ "--goal-color": activeModulePlayer.color } as CSSProperties}
              aria-hidden="true"
            />
          ) : null}
          {Array.from({ length: BOARD_SIZE }, (_, row) =>
            Array.from({ length: BOARD_SIZE }, (_, col) => {
              const pawn = publicState.players.find((player) => player.row === row && player.col === col);
              const legal = canAct && mode === "move" && legalMoveKeys.has(key(row, col));
              const selected = mode === "move" && sameCoord(selectedMove, row, col);
              return (
                <button
                  className={`qdr-cell ${legal ? "legal" : ""} ${selected ? "selected" : ""}`}
                  disabled={!legal}
                  key={key(row, col)}
                  onClick={() => selectPawnMove(row, col)}
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
          {canAct && mode === "wall" && !wallTouchesOuterEdge(wallRow, wallCol) ? (
            <span
              aria-hidden="true"
              className={`qdr-wall-preview ${orientation} ${selectedWallBlocked ? "blocked" : "valid"}`}
              style={wallPieceStyle(wallRow, wallCol)}
            />
          ) : null}
          {canAct && mode === "wall"
            ? Array.from({ length: WALL_GRID }, (_, row) =>
                Array.from({ length: WALL_GRID }, (_, col) => {
                  if (wallTouchesOuterEdge(row, col)) {
                    return null;
                  }
                  const selected = row === wallRow && col === wallCol;
                  const blocked = wallBlockedAt(orientation, row, col);
                  return (
                    <button
                      aria-disabled={blocked}
                      aria-label={`${row + 1}행 ${col + 1}열 ${orientation === "horizontal" ? "가로" : "세로"} 벽 ${
                        blocked ? "불가" : "후보 선택"
                      }`}
                      className={`qdr-wall-hit ${orientation} ${selected ? "selected" : ""} ${blocked ? "blocked" : "valid"}`}
                      key={`hit-${orientation}-${row}-${col}`}
                      onClick={() => selectWallAt(row, col)}
                      onFocus={() => previewWall(row, col)}
                      onPointerEnter={() => previewWall(row, col)}
                      style={wallPieceStyle(row, col)}
                      tabIndex={-1}
                      title={`${row + 1}-${col + 1} ${blocked ? "불가" : "벽 후보"}`}
                      type="button"
                    />
                  );
                })
              )
            : null}
        </div>

        <aside className="qdr-panel">
          <div className="qdr-players">
            {publicState.players.map((player) => (
              <div className="qdr-player" key={player.id}>
                <span className="qdr-swatch" style={{ background: player.color }} />
                <div>
                  <strong>{player.name}</strong>
                  <span>
                    남은 벽 {player.wallsRemaining}/{wallReserveTotal} · 목표 {goalLabel(player.goal)}
                  </span>
                  <div
                    className="qdr-wall-reserve"
                    aria-label={`${player.name} 남은 벽 ${player.wallsRemaining}개`}
                    style={{ "--wall-reserve-total": wallReserveTotal } as CSSProperties}
                  >
                    {Array.from({ length: wallReserveTotal }, (_, index) => (
                      <i key={index} className={index < player.wallsRemaining ? "available" : "spent"} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="qdr-action-mode" aria-label="쿼리도 행동 모드">
            <strong>행동 선택</strong>
            <div className="qdr-segment qdr-mode-segment">
              <button
                className={mode === "move" ? "active" : ""}
                disabled={!canAct}
                onClick={() => selectMode("move")}
                type="button"
              >
                말 이동
              </button>
              <button
                className={mode === "wall" ? "active" : ""}
                disabled={!canAct || !currentModulePlayer || currentModulePlayer.wallsRemaining <= 0}
                onClick={() => selectMode("wall")}
                type="button"
              >
                벽 설치
              </button>
            </div>
          </div>

          <div className="qdr-guidance" aria-label="쿼리도 행동 안내">
            <strong>이번 턴 후보</strong>
            <span>
              {mode === "move"
                ? `말 이동 ${moves.length}곳${selectedMove ? ` · 선택 ${selectedMove.row + 1}-${selectedMove.col + 1}` : ""}`
                : `선택 벽 ${wallRow + 1}-${wallCol + 1} ${orientationLabel(orientation)}`}
            </span>
            <p>
              {mode === "move"
                ? selectedMove
                  ? "선택한 이동 칸을 확인한 뒤 확정하세요."
                  : "밝게 표시된 칸 중 하나를 누른 뒤 이동을 확정하세요."
                : `벽은 두 칸 길이로 놓입니다. 바깥 테두리선과 맞닿는 위치는 선택할 수 없습니다. ${selectedWallReason}`}
            </p>
          </div>

          <div className="qdr-wall-controls">
            {mode === "move" ? (
              <>
                <strong>말 이동</strong>
                <div className="qdr-move-controls">
                  <span>{selectedMove ? `${selectedMove.row + 1}-${selectedMove.col + 1} 칸 선택됨` : "이동할 칸을 선택하세요."}</span>
                  <button
                    className="qdr-action"
                    disabled={!canAct || selectedMoveBlocked}
                    onClick={confirmSelectedMove}
                    type="button"
                  >
                    이동 확정
                  </button>
                </div>
              </>
            ) : (
              <>
                <strong>벽 설치</strong>
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
                <div className={`qdr-wall-grid ${orientation}`} aria-label="벽 후보 위치">
                  {Array.from({ length: WALL_GRID }, (_, row) =>
                    Array.from({ length: WALL_GRID }, (_, col) => {
                      const selected = row === wallRow && col === wallCol;
                      const blocked = wallBlockedAt(orientation, row, col);
                      return (
                        <button
                          className={`${selected ? "selected" : ""} ${blocked ? "blocked" : "valid"}`}
                          disabled={!canAct}
                          key={key(row, col)}
                          onClick={() => {
                            selectWallAt(row, col);
                          }}
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${row + 1}행 ${col + 1}열 ${orientation === "horizontal" ? "가로" : "세로"} 벽 ${
                            blocked ? "불가" : "가능"
                          }`}
                          title={`${row + 1}-${col + 1} ${blocked ? "불가" : "가능"}`}
                        >
                          <span className="qdr-wall-grid-mark" aria-hidden="true" />
                        </button>
                      );
                    })
                  )}
                </div>
                <span className={selectedWallBlocked ? "qdr-wall-hint blocked" : "qdr-wall-hint"}>
                  {selectedWallReason}
                </span>
                <button className="qdr-action" disabled={!canAct || selectedWallBlocked} onClick={sendWall} type="button">
                  벽 설치 확정
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
      {pendingConfirm ? (
        <div className="qdr-confirm-backdrop" role="presentation">
          <section
            aria-labelledby="qdr-confirm-title"
            aria-modal="true"
            className="qdr-confirm-dialog"
            role="dialog"
          >
            <strong id="qdr-confirm-title">
              {pendingConfirm.type === "move" ? "말을 이동하시겠습니까?" : "벽을 설치하시겠습니까?"}
            </strong>
            <p>{pendingDescription(pendingConfirm)}</p>
            <label className="qdr-confirm-check">
              <input
                checked={skipConfirm}
                onChange={(event) => setSkipConfirmChoice(event.currentTarget.checked)}
                type="checkbox"
              />
              다음부터 표기하지 않음
            </label>
            <div className="qdr-confirm-actions">
              <button onClick={() => setPendingConfirm(null)} type="button">
                취소
              </button>
              <button className="primary" onClick={confirmPending} type="button">
                확정
              </button>
            </div>
          </section>
        </div>
      ) : null}
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
.qdr-goal-edge {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  border-radius: 999px;
  background: var(--goal-color);
  box-shadow:
    0 0 0 2px rgba(255, 247, 209, 0.62),
    0 0 18px color-mix(in srgb, var(--goal-color) 60%, transparent);
}
.qdr-goal-edge.top,
.qdr-goal-edge.bottom {
  left: var(--qdr-padding);
  right: var(--qdr-padding);
  height: 6px;
}
.qdr-goal-edge.top {
  top: 5px;
}
.qdr-goal-edge.bottom {
  bottom: 5px;
}
.qdr-goal-edge.left,
.qdr-goal-edge.right {
  top: var(--qdr-padding);
  bottom: var(--qdr-padding);
  width: 6px;
}
.qdr-goal-edge.left {
  left: 5px;
}
.qdr-goal-edge.right {
  right: 5px;
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
.qdr-cell.selected {
  outline: 3px solid #fff3b8;
  outline-offset: -4px;
  box-shadow:
    inset 0 0 0 3px #15847b,
    inset 0 -4px 0 rgba(0, 0, 0, 0.24),
    0 0 14px rgba(21, 132, 123, 0.44);
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
.qdr-wall-preview {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  border-radius: 999px;
  opacity: 0.88;
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.32) 0 4px, transparent 4px 8px),
    linear-gradient(180deg, #f9df80, #b06a2d);
  box-shadow:
    0 0 0 2px rgba(255, 247, 209, 0.74),
    0 0 14px rgba(249, 223, 128, 0.5);
}
.qdr-wall-preview.blocked {
  opacity: 0.72;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.34) 0 4px, transparent 4px 8px),
    linear-gradient(180deg, #b74a3b, #5e2b24);
  box-shadow:
    0 0 0 2px rgba(255, 215, 190, 0.58),
    0 0 12px rgba(183, 74, 59, 0.42);
}
.qdr-wall-preview.horizontal {
  left: calc(var(--qdr-padding) + (var(--wall-col) * (var(--qdr-cell) + var(--qdr-gap))) + (var(--qdr-cell) * 0.08));
  top: calc(var(--qdr-padding) + ((var(--wall-row) + 1) * var(--qdr-cell)) + (var(--wall-row) * var(--qdr-gap)) + (var(--qdr-gap) * 0.05));
  width: calc((var(--qdr-cell) * 1.84) + var(--qdr-gap));
  height: calc(var(--qdr-gap) * 0.9);
}
.qdr-wall-preview.vertical {
  left: calc(var(--qdr-padding) + ((var(--wall-col) + 1) * var(--qdr-cell)) + (var(--wall-col) * var(--qdr-gap)) + (var(--qdr-gap) * 0.05));
  top: calc(var(--qdr-padding) + (var(--wall-row) * (var(--qdr-cell) + var(--qdr-gap))) + (var(--qdr-cell) * 0.08));
  width: calc(var(--qdr-gap) * 0.9);
  height: calc((var(--qdr-cell) * 1.84) + var(--qdr-gap));
}
.qdr-wall-hit {
  position: absolute;
  z-index: 5;
  display: block;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
}
.qdr-wall-hit::before {
  content: "";
  position: absolute;
  border-radius: inherit;
  opacity: 0;
  background: #f9df80;
  box-shadow: 0 0 0 1px rgba(255, 247, 209, 0.16);
  transition:
    opacity 140ms ease,
    transform 140ms ease,
    background 140ms ease;
}
.qdr-board:hover .qdr-wall-hit.valid::before {
  opacity: 0.08;
}
.qdr-wall-hit.horizontal {
  left: calc(var(--qdr-padding) + (var(--wall-col) * (var(--qdr-cell) + var(--qdr-gap))) + (var(--qdr-cell) * 0.08));
  top: calc(var(--qdr-padding) + ((var(--wall-row) + 1) * var(--qdr-cell)) + (var(--wall-row) * var(--qdr-gap)) - 7px);
  width: calc((var(--qdr-cell) * 1.84) + var(--qdr-gap));
  height: max(18px, calc(var(--qdr-gap) * 3));
}
.qdr-wall-hit.horizontal::before {
  top: 50%;
  right: 0;
  left: 0;
  height: max(5px, calc(var(--qdr-gap) * 0.9));
  transform: translateY(-50%);
}
.qdr-wall-hit.vertical {
  left: calc(var(--qdr-padding) + ((var(--wall-col) + 1) * var(--qdr-cell)) + (var(--wall-col) * var(--qdr-gap)) - 7px);
  top: calc(var(--qdr-padding) + (var(--wall-row) * (var(--qdr-cell) + var(--qdr-gap))) + (var(--qdr-cell) * 0.08));
  width: max(18px, calc(var(--qdr-gap) * 3));
  height: calc((var(--qdr-cell) * 1.84) + var(--qdr-gap));
}
.qdr-wall-hit.vertical::before {
  top: 0;
  bottom: 0;
  left: 50%;
  width: max(5px, calc(var(--qdr-gap) * 0.9));
  transform: translateX(-50%);
}
.qdr-wall-hit.valid:hover::before,
.qdr-wall-hit.valid:focus-visible::before,
.qdr-wall-hit.selected::before {
  opacity: 0.9;
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.26) 0 4px, transparent 4px 8px),
    linear-gradient(180deg, #f9df80, #b06a2d);
  box-shadow:
    0 0 0 2px rgba(255, 247, 209, 0.68),
    0 0 14px rgba(249, 223, 128, 0.45);
}
.qdr-wall-hit.blocked:hover::before,
.qdr-wall-hit.blocked:focus-visible::before,
.qdr-wall-hit.blocked.selected::before {
  opacity: 0.78;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.28) 0 4px, transparent 4px 8px),
    linear-gradient(180deg, #b74a3b, #5e2b24);
  box-shadow:
    0 0 0 2px rgba(255, 215, 190, 0.58),
    0 0 12px rgba(183, 74, 59, 0.42);
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
.qdr-wall-reserve {
  display: grid;
  grid-template-columns: repeat(var(--wall-reserve-total), minmax(0, 1fr));
  gap: 3px;
  margin-top: 6px;
}
.qdr-wall-reserve i {
  display: block;
  min-width: 0;
  height: 14px;
  border: 1px solid rgba(74, 40, 17, 0.28);
  border-radius: 3px;
  background:
    linear-gradient(90deg, rgba(255, 226, 155, 0.16), transparent 48%),
    linear-gradient(180deg, #5d351c, #211208);
  box-shadow:
    inset 0 1px 0 rgba(255, 229, 166, 0.18),
    0 1px 2px rgba(48, 27, 12, 0.18);
}
.qdr-wall-reserve i.spent {
  opacity: 0.22;
  background: rgba(92, 54, 24, 0.34);
}
.qdr-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(23, 32, 29, 0.2);
  border-radius: 999px;
}
.qdr-guidance {
  display: grid;
  gap: 5px;
  border: 1px solid rgba(255, 218, 135, 0.24);
  border-radius: 8px;
  padding: 10px;
  background:
    linear-gradient(180deg, #ffefc7, #d89c55);
  color: #211513;
  box-shadow: inset 0 -3px 0 rgba(75, 42, 19, 0.14);
}
.qdr-guidance strong,
.qdr-guidance span,
.qdr-guidance p {
  min-width: 0;
  overflow-wrap: anywhere;
}
.qdr-guidance span {
  color: #52625d;
  font-size: 0.84rem;
  font-weight: 800;
}
.qdr-guidance p {
  margin: 0;
  color: #36251f;
  font-size: 0.86rem;
  line-height: 1.35;
}
.qdr-action-mode {
  display: grid;
  gap: 8px;
  min-width: 0;
  border: 1px solid rgba(255, 218, 135, 0.24);
  border-radius: 8px;
  padding: 10px;
  background:
    linear-gradient(180deg, #ffefc7, #d89c55);
  color: #211513;
  box-shadow: inset 0 -3px 0 rgba(75, 42, 19, 0.14);
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
.qdr-mode-segment button {
  min-height: 42px;
  font-weight: 900;
}
.qdr-segment button,
.qdr-action,
.qdr-wall-grid button,
.qdr-confirm-actions button {
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
.qdr-action,
.qdr-confirm-actions .primary {
  background:
    linear-gradient(180deg, #f9d36f, #9d5626);
  color: #211513;
}
.qdr-move-controls {
  display: grid;
  gap: 9px;
}
.qdr-move-controls span {
  display: block;
  min-height: 36px;
  border: 1px solid rgba(84, 45, 20, 0.2);
  border-radius: 7px;
  padding: 9px;
  background: rgba(255, 248, 220, 0.64);
  color: #2b1a12;
  font-weight: 900;
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
.qdr-wall-grid.vertical button::before {
  width: 9px;
  height: 72%;
}
.qdr-wall-grid button.selected {
  outline: 2px solid #fdf7c3;
  outline-offset: 1px;
}
.qdr-wall-grid button.valid {
  box-shadow:
    inset 0 -3px 0 rgba(90, 45, 16, 0.18),
    0 0 0 1px rgba(28, 117, 76, 0.22),
    0 2px 0 rgba(42, 20, 10, 0.18);
}
.qdr-wall-grid button.blocked {
  background: #5e3a32;
}
.qdr-wall-grid button.blocked::before {
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.24) 0 4px, transparent 4px 8px),
    #9b3d34;
}
.qdr-wall-hint {
  color: #155847;
  font-size: 0.84rem;
  line-height: 1.35;
}
.qdr-wall-hint.blocked {
  color: #8f2c25;
}
.qdr-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(19, 11, 7, 0.54);
}
.qdr-confirm-dialog {
  display: grid;
  gap: 12px;
  width: min(100%, 360px);
  border: 1px solid rgba(255, 222, 150, 0.58);
  border-radius: 10px;
  padding: 16px;
  background:
    linear-gradient(180deg, rgba(255, 240, 203, 0.98), rgba(211, 151, 76, 0.96));
  color: #20140f;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    0 18px 52px rgba(0, 0, 0, 0.45);
}
.qdr-confirm-dialog strong {
  font-size: 1.08rem;
}
.qdr-confirm-dialog p {
  margin: 0;
  color: #3b2a21;
  line-height: 1.4;
}
.qdr-confirm-check {
  display: flex;
  gap: 8px;
  align-items: center;
  color: #2b1a12;
  font-weight: 800;
}
.qdr-confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.qdr-confirm-actions button {
  min-height: 42px;
  font-weight: 900;
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
@media (max-width: 540px) {
  .qdr-shell {
    padding: 10px;
  }
  .qdr-layout {
    margin-inline: -10px;
    padding-inline: 10px;
  }
  .qdr-board {
    width: 450px;
  }
  .qdr-wall-grid {
    min-width: 336px;
    gap: 4px;
  }
  .qdr-wall-grid button {
    min-width: 38px;
    min-height: 38px;
  }
}
`;
