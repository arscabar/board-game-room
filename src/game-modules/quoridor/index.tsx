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

function legalPawnMoves(state: QuoridorState, player: QuoridorPlayer) {
  const deltas = [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 }
  ];

  return deltas
    .map((delta) => ({ row: player.row + delta.row, col: player.col + delta.col }))
    .filter((target) => {
      return (
        inBoard(target.row, target.col) &&
        !wallBlocksMove(state, player, target) &&
        !occupiedByOther(state, target.row, target.col, player.id)
      );
    });
}

function wallWouldOverlap(state: QuoridorState, orientation: Orientation, row: number, col: number) {
  if (!inWallGrid(row, col)) return true;
  const wallKey = key(row, col);
  return state.walls.horizontal.includes(wallKey) || state.walls.vertical.includes(wallKey);
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
    throw new Error("Game is already complete.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("It is not your turn.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("Player is not in this Quoridor game.");
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
    message: "Move your pawn or place one wall."
  };
}

function movePawn(state: QuoridorState, action: GameAction, context: GameContext): GameActionResult {
  if (!isCoord(action.payload)) {
    throw new Error("Pawn move needs a target cell.");
  }

  const player = requireActivePlayer(state, context);
  const target = action.payload;
  if (!legalPawnMoves(state, player).some((move) => move.row === target.row && move.col === target.col)) {
    throw new Error("That pawn move is blocked.");
  }

  const next = cloneState(state);
  const nextPlayer = next.players.find((candidate) => candidate.id === player.id);
  if (!nextPlayer) {
    throw new Error("Player is not in this Quoridor game.");
  }

  nextPlayer.row = target.row;
  nextPlayer.col = target.col;

  if (reachesGoal(nextPlayer)) {
    next.winnerId = nextPlayer.id;
    next.message = `${nextPlayer.name} reached the goal edge.`;
    return {
      state: next,
      log: `${nextPlayer.name} wins by reaching the goal edge`,
      activePlayerId: null,
      winnerId: nextPlayer.id,
      message: next.message
    };
  }

  next.message = `${nextPlayer.name} moved to ${target.row + 1}-${target.col + 1}.`;
  return {
    state: next,
    log: `${nextPlayer.name} moved pawn`,
    message: next.message,
    ...advanceTurn(next, context)
  };
}

function placeWall(state: QuoridorState, action: GameAction, context: GameContext): GameActionResult {
  if (!isWallPayload(action.payload)) {
    throw new Error("Wall placement needs orientation, row, and column.");
  }

  const player = requireActivePlayer(state, context);
  const { orientation, row, col } = action.payload;

  if (player.wallsRemaining <= 0) {
    throw new Error("No walls remaining.");
  }
  if (wallWouldOverlap(state, orientation, row, col)) {
    throw new Error("That wall slot is already occupied or crossed.");
  }
  if (!wallPreservesPaths(state, orientation, row, col)) {
    throw new Error("Every player must keep at least one path to their goal.");
  }

  const next = stateWithWall(state, orientation, row, col);
  const nextPlayer = next.players.find((candidate) => candidate.id === player.id);
  if (!nextPlayer) {
    throw new Error("Player is not in this Quoridor game.");
  }
  nextPlayer.wallsRemaining -= 1;
  next.message = `${nextPlayer.name} placed a ${orientation} wall.`;

  return {
    state: next,
    log: `${nextPlayer.name} placed ${orientation} wall`,
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
    throw new Error("Unknown Quoridor action.");
  }
};

function goalLabel(goal: Goal) {
  if (goal === "top") return "top edge";
  if (goal === "bottom") return "bottom edge";
  if (goal === "left") return "left edge";
  return "right edge";
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
          <strong>{publicState.winnerId ? "Winner" : "Turn"}</strong>
          <span>
            {publicState.winnerId
              ? publicState.players.find((player) => player.id === publicState.winnerId)?.name
              : activeModulePlayer?.name ?? "Waiting"}
          </span>
        </div>
        <p>{publicState.message}</p>
      </div>

      <div className="qdr-layout">
        <div className="qdr-board" aria-label="Quoridor board">
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
                  title={`Row ${row + 1}, column ${col + 1}`}
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
        </div>

        <aside className="qdr-panel">
          <div className="qdr-players">
            {publicState.players.map((player) => (
              <div className="qdr-player" key={player.id}>
                <span className="qdr-swatch" style={{ background: player.color }} />
                <div>
                  <strong>{player.name}</strong>
                  <span>
                    {player.wallsRemaining} walls - goal {goalLabel(player.goal)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="qdr-wall-controls">
            <strong>Wall placement</strong>
            <div className="qdr-segment">
              <button
                className={orientation === "horizontal" ? "active" : ""}
                disabled={!canAct}
                onClick={() => setOrientation("horizontal")}
                type="button"
              >
                H
              </button>
              <button
                className={orientation === "vertical" ? "active" : ""}
                disabled={!canAct}
                onClick={() => setOrientation("vertical")}
                type="button"
              >
                V
              </button>
            </div>
            <div className="qdr-wall-grid">
              {Array.from({ length: WALL_GRID }, (_, row) =>
                Array.from({ length: WALL_GRID }, (_, col) => {
                  const selected = row === wallRow && col === wallCol;
                  const blocked = wallWouldOverlap(publicState, orientation, row, col);
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
                      {orientation === "horizontal" ? "H" : "V"}
                    </button>
                  );
                })
              )}
            </div>
            <button className="qdr-action" disabled={!canAct || selectedWallBlocked} onClick={sendWall} type="button">
              Place wall {wallRow + 1}-{wallCol + 1}
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
  color: #17201d;
}
.qdr-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 12px;
  background: #fffaf3;
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
  grid-template-columns: minmax(280px, 1fr) 260px;
  gap: 16px;
  align-items: start;
}
.qdr-board {
  display: grid;
  grid-template-columns: repeat(9, minmax(30px, 1fr));
  gap: 3px;
  width: min(100%, 520px);
  aspect-ratio: 1;
  padding: 8px;
  border: 1px solid rgba(23, 32, 29, 0.2);
  border-radius: 8px;
  background: #c89a62;
}
.qdr-cell {
  display: grid;
  place-items: center;
  min-height: 0;
  aspect-ratio: 1;
  border: 3px solid rgba(255, 255, 255, 0.35);
  border-radius: 6px;
  background: #f6dfb7;
  color: #17201d;
  padding: 0;
}
.qdr-cell.legal {
  background: #f9f3d5;
  box-shadow: inset 0 0 0 2px #28777c;
}
.qdr-pawn {
  display: grid;
  place-items: center;
  width: 70%;
  aspect-ratio: 1;
  border: 2px solid rgba(17, 24, 39, 0.25);
  border-radius: 999px;
  font-weight: 900;
}
.qdr-dot {
  width: 36%;
  aspect-ratio: 1;
  border-radius: 999px;
  background: #28777c;
}
.qdr-panel {
  display: grid;
  gap: 14px;
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
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 9px;
  background: #fbfcfa;
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
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 10px;
  background: #fbfcfa;
}
.qdr-segment {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.qdr-segment button,
.qdr-action,
.qdr-wall-grid button {
  border: 1px solid rgba(23, 32, 29, 0.18);
  border-radius: 8px;
  background: #edf2ed;
  color: #17201d;
}
.qdr-segment button.active,
.qdr-action {
  background: #17201d;
  color: white;
}
.qdr-wall-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.qdr-wall-grid button {
  min-height: 30px;
  padding: 0;
  font-size: 0.72rem;
}
.qdr-wall-grid button.selected {
  outline: 2px solid #28777c;
  outline-offset: 1px;
}
.qdr-wall-grid button.blocked {
  color: #8f2c25;
  background: #faedea;
}
@media (max-width: 780px) {
  .qdr-layout {
    grid-template-columns: 1fr;
  }
}
`;
