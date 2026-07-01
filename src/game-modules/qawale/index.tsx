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
  return state.players.find((player) => player.id === playerId)?.name ?? "Player";
}

function hasAlternativeForwardStep(current: Coord, previous: Coord) {
  return neighbors(current).some((candidate) => !sameCoord(candidate, previous));
}

function validatePath(source: Coord, path: Coord[], carryLength: number) {
  if (path.length !== carryLength) {
    throw new Error(`Path must contain ${carryLength} steps.`);
  }

  for (let index = 0; index < path.length; index += 1) {
    const current = index === 0 ? source : path[index - 1];
    const target = path[index];
    if (!inBoard(target.row, target.col) || !adjacent(current, target)) {
      throw new Error("Distribution path must move orthogonally one space at a time.");
    }

    if (index > 0) {
      const previous = index === 1 ? source : path[index - 2];
      if (sameCoord(target, previous) && hasAlternativeForwardStep(current, previous)) {
        throw new Error("Do not immediately reverse direction while another step is available.");
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
  if (state.winnerId) {
    throw new Error("Game is already complete.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("It is not your turn.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("Player is not in this Qawale game.");
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
    winnerId: null,
    message: "Choose a non-empty stack, add your stone, then distribute the stack."
  };
}

function distribute(state: QawaleState, action: GameAction, context: GameContext): GameActionResult {
  if (!isDistributePayload(action.payload)) {
    throw new Error("Qawale move needs a source cell and distribution path.");
  }

  const player = requireActivePlayer(state, context);
  const { source, path } = action.payload;
  if (!inBoard(source.row, source.col)) {
    throw new Error("Source cell is outside the board.");
  }
  const sourceStack = state.board[source.row][source.col];
  if (sourceStack.length === 0) {
    throw new Error("You must place on a non-empty stack.");
  }
  if ((state.reserves[player.id] ?? 0) <= 0) {
    throw new Error("No reserve stones remaining.");
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
    next.winnerId = winnerId;
    next.message = `${playerName(next, winnerId)} made a visible four-in-line.`;
    return {
      state: next,
      log: `${playerName(next, winnerId)} wins with four top stones`,
      activePlayerId: null,
      winnerId,
      message: next.message
    };
  }

  next.message = `${player.name} distributed ${carry.length} stones from ${source.row + 1}-${source.col + 1}.`;
  return {
    state: next,
    log: `${player.name} distributed a stack`,
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
    throw new Error("Unknown Qawale action.");
  }
};

function stoneColor(state: QawalePublicState, stone: Stone | null) {
  if (!stone) return "transparent";
  if (stone === NEUTRAL) return "#eef0e8";
  return state.players.find((player) => player.id === stone)?.color ?? "#52625d";
}

function stoneLabel(state: QawalePublicState, stone: Stone | null) {
  if (!stone) return "";
  if (stone === NEUTRAL) return "N";
  return String(state.players.find((player) => player.id === stone)?.seat ?? "?");
}

function canAppendPath(source: Coord | null, path: Coord[], target: Coord) {
  if (!source) return false;
  const current = path.length === 0 ? source : path[path.length - 1];
  if (!inBoard(target.row, target.col) || !adjacent(current, target)) return false;
  if (path.length > 0) {
    const previous = path.length === 1 ? source : path[path.length - 2];
    if (sameCoord(target, previous) && hasAlternativeForwardStep(current, previous)) {
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
  const canAct = !disabled && !publicState.winnerId && currentPlayer?.id === activePlayer?.id && Boolean(currentModulePlayer);
  const carryLength = source ? publicState.board[source.row][source.col].length + 1 : 0;
  const pathComplete = source && path.length === carryLength;
  const nextTargets = useMemo(() => {
    if (!source || pathComplete) return new Set<string>();
    return new Set(
      neighbors(path.length === 0 ? source : path[path.length - 1])
        .filter((candidate) => canAppendPath(source, path, candidate))
        .map((candidate) => key(candidate.row, candidate.col))
    );
  }, [source, path, pathComplete]);

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
          <strong>{publicState.winnerId ? "Winner" : "Turn"}</strong>
          <span>
            {publicState.winnerId
              ? playerName(publicState, publicState.winnerId)
              : activeModulePlayer?.name ?? "Waiting"}
          </span>
        </div>
        <p>{publicState.message}</p>
      </div>

      <div className="qaw-layout">
        <div className="qaw-board" aria-label="Qawale board">
          {publicState.board.map((row, rowIndex) =>
            row.map((stack, colIndex) => {
              const top = stack[stack.length - 1] ?? null;
              const cellKey = key(rowIndex, colIndex);
              const selected = source?.row === rowIndex && source.col === colIndex;
              const inPath = path.some((coord) => coord.row === rowIndex && coord.col === colIndex);
              const next = nextTargets.has(cellKey);
              return (
                <button
                  className={`qaw-cell ${selected ? "selected" : ""} ${inPath ? "path" : ""} ${next ? "next" : ""}`}
                  disabled={!canAct || (!source && stack.length === 0)}
                  key={cellKey}
                  onClick={() => selectCell(rowIndex, colIndex)}
                  type="button"
                >
                  <span
                    className="qaw-top"
                    style={
                      {
                        "--stone-color": stoneColor(publicState, top),
                        color: top === NEUTRAL ? "#17201d" : "white"
                      } as CSSProperties
                    }
                  >
                    {stoneLabel(publicState, top)}
                  </span>
                  <span className="qaw-height">{stack.length}</span>
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
                  <span>{publicState.reserves[player.id] ?? 0} reserve stones</span>
                </div>
              </div>
            ))}
          </div>

          <div className="qaw-route">
            <strong>Route</strong>
            <span>
              {source
                ? `${path.length}/${carryLength} drops from ${source.row + 1}-${source.col + 1}`
                : "Choose a non-empty source stack"}
            </span>
            <div className="qaw-route-list">
              {path.map((coord, index) => (
                <span key={`${index}-${key(coord.row, coord.col)}`}>{`${coord.row + 1}-${coord.col + 1}`}</span>
              ))}
            </div>
            <div className="qaw-actions">
              <button disabled={!source} onClick={resetPath} type="button">
                Clear
              </button>
              <button disabled={!canAct || !pathComplete} onClick={submitMove} type="button">
                Distribute
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
}
.qaw-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 12px;
  background: #f5f8fb;
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
  margin: 0;
}
.qaw-layout {
  display: grid;
  grid-template-columns: minmax(280px, 420px) minmax(220px, 1fr);
  gap: 16px;
  align-items: start;
}
.qaw-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(56px, 1fr));
  gap: 8px;
  width: min(100%, 420px);
  aspect-ratio: 1;
  padding: 10px;
  border: 1px solid rgba(23, 32, 29, 0.18);
  border-radius: 8px;
  background: #d8e4ed;
}
.qaw-cell {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 0;
  border: 1px solid rgba(23, 32, 29, 0.16);
  border-radius: 8px;
  background: #fbfcfa;
  color: #17201d;
}
.qaw-cell.selected {
  outline: 3px solid #315c8c;
  outline-offset: 1px;
}
.qaw-cell.path {
  background: #f9f3d5;
}
.qaw-cell.next {
  box-shadow: inset 0 0 0 3px #28777c;
}
.qaw-top {
  display: grid;
  place-items: center;
  width: 58%;
  aspect-ratio: 1;
  border: 2px solid rgba(23, 32, 29, 0.2);
  border-radius: 999px;
  background: var(--stone-color);
  font-weight: 900;
}
.qaw-height {
  position: absolute;
  right: 7px;
  bottom: 5px;
  color: #52625d;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 0.8rem;
  font-weight: 800;
}
.qaw-panel {
  display: grid;
  gap: 14px;
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
  background: #fbfcfa;
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
.qaw-route {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 10px;
  background: #fbfcfa;
}
.qaw-route > span {
  color: #52625d;
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
  background: #edf2ed;
  font-size: 0.84rem;
  font-weight: 800;
}
.qaw-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.qaw-actions button {
  border: 1px solid rgba(23, 32, 29, 0.16);
  border-radius: 8px;
  background: #edf2ed;
  color: #17201d;
}
.qaw-actions button:last-child {
  color: white;
  background: #17201d;
}
@media (max-width: 760px) {
  .qaw-layout {
    grid-template-columns: 1fr;
  }
}
`;
