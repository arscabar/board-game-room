import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const RADIUS = 4;
const WIN_PUSHES = 6;

interface Coord {
  q: number;
  r: number;
}

interface Direction extends Coord {
  id: string;
  label: string;
}

interface AbalonePlayer {
  id: string;
  name: string;
  seat: number;
  color: string;
}

interface AbaloneState {
  players: AbalonePlayer[];
  marbles: Record<string, string>;
  pushedOff: Record<string, number>;
  winnerId: string | null;
  message: string;
}

type AbalonePublicState = AbaloneState;

interface MovePayload {
  cells: Coord[];
  direction: string;
}

const directions: Direction[] = [
  { id: "E", label: "E", q: 1, r: 0 },
  { id: "W", label: "W", q: -1, r: 0 },
  { id: "SE", label: "SE", q: 0, r: 1 },
  { id: "NW", label: "NW", q: 0, r: -1 },
  { id: "SW", label: "SW", q: -1, r: 1 },
  { id: "NE", label: "NE", q: 1, r: -1 }
];

const playerColors = ["#111827", "#f8fafc"];

function key(coord: Coord) {
  return `${coord.q},${coord.r}`;
}

function parseKey(coordKey: string): Coord {
  const [q, r] = coordKey.split(",").map(Number);
  return { q, r };
}

function add(coord: Coord, direction: Coord): Coord {
  return { q: coord.q + direction.q, r: coord.r + direction.r };
}

function sameCoord(a: Coord, b: Coord) {
  return a.q === b.q && a.r === b.r;
}

function opposite(direction: Coord): Coord {
  return { q: -direction.q, r: -direction.r };
}

function sameDirection(a: Coord, b: Coord) {
  return a.q === b.q && a.r === b.r;
}

function isCoord(value: unknown): value is Coord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.q) && Number.isInteger(item.r);
}

function isMovePayload(value: unknown): value is MovePayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Array.isArray(item.cells) && item.cells.every(isCoord) && typeof item.direction === "string";
}

function inBoard(coord: Coord) {
  const s = -coord.q - coord.r;
  return Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(s)) <= RADIUS;
}

function allCells() {
  const cells: Coord[] = [];
  for (let r = -RADIUS; r <= RADIUS; r += 1) {
    for (let q = -RADIUS; q <= RADIUS; q += 1) {
      const coord = { q, r };
      if (inBoard(coord)) cells.push(coord);
    }
  }
  return cells;
}

function rowCells(row: number) {
  return allCells()
    .filter((coord) => coord.r === row)
    .sort((a, b) => a.q - b.q);
}

function cloneState(state: AbaloneState): AbaloneState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    marbles: { ...state.marbles },
    pushedOff: { ...state.pushedOff }
  };
}

function directionById(id: string) {
  return directions.find((direction) => direction.id === id) ?? null;
}

function ownerAt(state: AbaloneState, coord: Coord) {
  return state.marbles[key(coord)] ?? null;
}

function isSelectionLine(cells: Coord[]) {
  if (cells.length === 1) return true;
  const selected = new Set(cells.map(key));

  for (const direction of directions) {
    for (const start of cells) {
      const line = Array.from({ length: cells.length }, (_, index) => ({
        q: start.q + direction.q * index,
        r: start.r + direction.r * index
      }));
      if (line.every((coord) => selected.has(key(coord)))) {
        return true;
      }
    }
  }

  return false;
}

function selectionAxis(cells: Coord[]) {
  if (cells.length === 1) return null;
  const selected = new Set(cells.map(key));

  for (const direction of directions) {
    for (const start of cells) {
      const line = Array.from({ length: cells.length }, (_, index) => ({
        q: start.q + direction.q * index,
        r: start.r + direction.r * index
      }));
      if (line.every((coord) => selected.has(key(coord)))) {
        return direction;
      }
    }
  }

  return null;
}

function inlineWith(axis: Coord | null, direction: Coord) {
  if (!axis) return true;
  return sameDirection(axis, direction) || sameDirection(opposite(axis), direction);
}

function orderAlongMove(cells: Coord[], direction: Coord) {
  const selected = new Set(cells.map(key));
  const back =
    cells.find((coord) => {
      const previous = add(coord, opposite(direction));
      return !selected.has(key(previous));
    }) ?? cells[0];
  const ordered: Coord[] = [];
  let cursor = back;
  while (selected.has(key(cursor))) {
    ordered.push(cursor);
    cursor = add(cursor, direction);
  }
  return ordered;
}

function connectedModulePlayers(state: AbaloneState, context: GameContext) {
  return state.players.filter((player) =>
    context.players.some((candidate) => candidate.id === player.id && candidate.connected)
  );
}

function advanceTurn(state: AbaloneState, context: GameContext) {
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

function requireActivePlayer(state: AbaloneState, context: GameContext) {
  if (state.winnerId) {
    throw new Error("Game is already complete.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("It is not your turn.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("Player is not in this Abalone game.");
  }
  return player;
}

function placeInitialMarbles(players: AbalonePlayer[]) {
  const marbles: Record<string, string> = {};
  const first = players[0]?.id;
  const second = players[1]?.id;

  if (first) {
    for (let q = 0; q <= 4; q += 1) marbles[key({ q, r: -4 })] = first;
    for (let q = -1; q <= 4; q += 1) marbles[key({ q, r: -3 })] = first;
    for (let q = 0; q <= 2; q += 1) marbles[key({ q, r: -2 })] = first;
  }

  if (second) {
    for (let q = -4; q <= 0; q += 1) marbles[key({ q, r: 4 })] = second;
    for (let q = -4; q <= 1; q += 1) marbles[key({ q, r: 3 })] = second;
    for (let q = -2; q <= 0; q += 1) marbles[key({ q, r: 2 })] = second;
  }

  return marbles;
}

function createInitialState(context: Pick<GameContext, "players">): AbaloneState {
  const players = context.players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 2)
    .map((player, index) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      color: playerColors[index]
    }));
  const pushedOff: Record<string, number> = {};
  for (const player of players) {
    pushedOff[player.id] = 0;
  }

  return {
    players,
    marbles: placeInitialMarbles(players),
    pushedOff,
    winnerId: null,
    message: "Select 1 to 3 marbles in a line, then choose a direction."
  };
}

function moveBroadside(state: AbaloneState, player: AbalonePlayer, cells: Coord[], direction: Direction) {
  for (const cell of cells) {
    const target = add(cell, direction);
    if (!inBoard(target) || ownerAt(state, target)) {
      throw new Error("Broadside moves need every target space to be empty and on the board.");
    }
  }

  const next = cloneState(state);
  for (const cell of cells) delete next.marbles[key(cell)];
  for (const cell of cells) next.marbles[key(add(cell, direction))] = player.id;
  next.message = `${player.name} moved ${cells.length} marble${cells.length === 1 ? "" : "s"} ${direction.label}.`;
  return next;
}

function moveInline(state: AbaloneState, player: AbalonePlayer, cells: Coord[], direction: Direction) {
  const ordered = orderAlongMove(cells, direction);
  const front = ordered[ordered.length - 1];
  const firstTarget = add(front, direction);

  if (!inBoard(firstTarget)) {
    throw new Error("You cannot move your own marble off the board.");
  }

  const firstOwner = ownerAt(state, firstTarget);
  const next = cloneState(state);

  if (!firstOwner) {
    for (const cell of ordered) delete next.marbles[key(cell)];
    for (const cell of ordered) next.marbles[key(add(cell, direction))] = player.id;
    next.message = `${player.name} moved inline ${direction.label}.`;
    return next;
  }

  if (firstOwner === player.id) {
    throw new Error("Your own marble blocks that inline move.");
  }

  const opponents: Coord[] = [];
  let cursor = firstTarget;
  while (inBoard(cursor)) {
    const owner = ownerAt(state, cursor);
    if (!owner) break;
    if (owner === player.id) {
      throw new Error("A friendly marble behind the opponent line blocks the push.");
    }
    opponents.push(cursor);
    cursor = add(cursor, direction);
  }

  if (opponents.length === 0 || opponents.length >= ordered.length) {
    throw new Error("Inline pushes require more pushing marbles than opposing marbles.");
  }

  const landingIsBoard = inBoard(cursor);
  if (landingIsBoard && ownerAt(state, cursor)) {
    throw new Error("The pushed line has no landing space.");
  }

  for (const cell of ordered) delete next.marbles[key(cell)];
  for (const cell of opponents) delete next.marbles[key(cell)];

  if (landingIsBoard) {
    for (let index = opponents.length - 1; index >= 0; index -= 1) {
      const opponentCell = opponents[index];
      next.marbles[key(add(opponentCell, direction))] = firstOwner;
    }
  } else {
    for (let index = opponents.length - 2; index >= 0; index -= 1) {
      const opponentCell = opponents[index];
      next.marbles[key(add(opponentCell, direction))] = firstOwner;
    }
    next.pushedOff[player.id] = (next.pushedOff[player.id] ?? 0) + 1;
  }

  for (const cell of ordered) {
    next.marbles[key(add(cell, direction))] = player.id;
  }

  next.message = landingIsBoard
    ? `${player.name} pushed ${opponents.length} opposing marble${opponents.length === 1 ? "" : "s"}.`
    : `${player.name} pushed a marble off the board.`;
  return next;
}

function applyMove(state: AbaloneState, action: GameAction, context: GameContext): GameActionResult {
  if (!isMovePayload(action.payload)) {
    throw new Error("Abalone move needs selected cells and a direction.");
  }

  const player = requireActivePlayer(state, context);
  const direction = directionById(action.payload.direction);
  if (!direction) {
    throw new Error("Unknown movement direction.");
  }

  const cells = action.payload.cells;
  const uniqueKeys = new Set(cells.map(key));
  if (cells.length < 1 || cells.length > 3 || uniqueKeys.size !== cells.length) {
    throw new Error("Select 1 to 3 unique marbles.");
  }
  for (const cell of cells) {
    if (!inBoard(cell) || ownerAt(state, cell) !== player.id) {
      throw new Error("Selection must contain only your own marbles.");
    }
  }
  if (!isSelectionLine(cells)) {
    throw new Error("Selected marbles must be contiguous and in one line.");
  }

  const axis = selectionAxis(cells);
  const next = inlineWith(axis, direction)
    ? moveInline(state, player, cells, direction)
    : moveBroadside(state, player, cells, direction);

  if ((next.pushedOff[player.id] ?? 0) >= WIN_PUSHES) {
    next.winnerId = player.id;
    next.message = `${player.name} pushed off six opposing marbles.`;
    return {
      state: next,
      log: `${player.name} wins by pushing off six marbles`,
      activePlayerId: null,
      winnerId: player.id,
      message: next.message
    };
  }

  return {
    state: next,
    log: `${player.name} moved ${cells.length} marble${cells.length === 1 ? "" : "s"} ${direction.label}`,
    message: next.message,
    ...advanceTurn(next, context)
  };
}

export const module: GameModule = {
  id: "abalone-classic",
  createInitialState,
  getPublicState: (state) => state as AbalonePublicState,
  applyAction: (state, action, context) => {
    if (action.type === "move") {
      return applyMove(state as AbaloneState, action, context);
    }
    throw new Error("Unknown Abalone action.");
  }
};

function marbleTextColor(color: string) {
  return color === "#f8fafc" ? "#17201d" : "white";
}

function ownerColor(state: AbalonePublicState, owner: string | null) {
  if (!owner) return "transparent";
  return state.players.find((player) => player.id === owner)?.color ?? "#52625d";
}

function ownerSeat(state: AbalonePublicState, owner: string | null) {
  if (!owner) return "";
  return String(state.players.find((player) => player.id === owner)?.seat ?? "?");
}

function selectionCanAdd(state: AbalonePublicState, playerId: string | undefined, selection: Coord[], coord: Coord) {
  if (!playerId || ownerAt(state, coord) !== playerId) return false;
  if (selection.some((item) => sameCoord(item, coord))) return true;
  if (selection.length >= 3) return false;
  return isSelectionLine([...selection, coord]);
}

export function Component(props: GameComponentProps) {
  const { currentPlayer, activePlayer, disabled, onAction } = props;
  const publicState = props.publicState as AbalonePublicState;
  const [selection, setSelection] = useState<Coord[]>([]);
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const canAct = !disabled && !publicState.winnerId && currentPlayer?.id === activePlayer?.id && Boolean(currentModulePlayer);
  const validSelection = selection.length > 0 && selection.length <= 3 && isSelectionLine(selection);
  const selectedKeys = new Set(selection.map(key));
  const rows = useMemo(() => Array.from({ length: RADIUS * 2 + 1 }, (_, index) => index - RADIUS), []);

  function toggleSelection(coord: Coord) {
    if (!canAct) return;
    if (selectedKeys.has(key(coord))) {
      setSelection(selection.filter((item) => !sameCoord(item, coord)));
      return;
    }
    if (selectionCanAdd(publicState, currentPlayer?.id, selection, coord)) {
      setSelection([...selection, coord]);
    }
  }

  function sendMove(direction: Direction) {
    if (!canAct || !validSelection) return;
    onAction({ type: "move", payload: { cells: selection, direction: direction.id } });
    setSelection([]);
  }

  return (
    <div className="abl-shell">
      <style>{abaloneStyles}</style>
      <div className="abl-status">
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

      <div className="abl-layout">
        <div className="abl-board" aria-label="Abalone board">
          {rows.map((row) => {
            const cells = rowCells(row);
            return (
              <div className="abl-row" key={row} style={{ "--row-size": cells.length } as CSSProperties}>
                {cells.map((coord) => {
                  const owner = ownerAt(publicState, coord);
                  const selected = selectedKeys.has(key(coord));
                  const selectable = canAct && selectionCanAdd(publicState, currentPlayer?.id, selection, coord);
                  const color = ownerColor(publicState, owner);
                  return (
                    <button
                      className={`abl-cell ${selected ? "selected" : ""} ${selectable ? "selectable" : ""}`}
                      disabled={!selectable}
                      key={key(coord)}
                      onClick={() => toggleSelection(coord)}
                      type="button"
                      title={`${coord.q},${coord.r}`}
                    >
                      {owner ? (
                        <span
                          className="abl-marble"
                          style={{ background: color, color: marbleTextColor(color) }}
                        >
                          {ownerSeat(publicState, owner)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <aside className="abl-panel">
          <div className="abl-players">
            {publicState.players.map((player) => (
              <div className="abl-player" key={player.id}>
                <span className="abl-swatch" style={{ background: player.color }} />
                <div>
                  <strong>{player.name}</strong>
                  <span>{publicState.pushedOff[player.id] ?? 0}/6 pushed off</span>
                </div>
              </div>
            ))}
          </div>

          <div className="abl-controls">
            <strong>Move direction</strong>
            <span>{selection.length} selected</span>
            <div className="abl-directions">
              {directions.map((direction) => (
                <button disabled={!canAct || !validSelection} key={direction.id} onClick={() => sendMove(direction)} type="button">
                  {direction.label}
                </button>
              ))}
            </div>
            <button className="abl-clear" disabled={selection.length === 0} onClick={() => setSelection([])} type="button">
              Clear selection
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

const abaloneStyles = `
.abl-shell {
  display: grid;
  gap: 14px;
  color: #17201d;
}
.abl-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 12px;
  background: #f4f5f7;
}
.abl-status strong,
.abl-status span {
  display: block;
}
.abl-status span,
.abl-status p {
  color: #52625d;
}
.abl-status p {
  margin: 0;
}
.abl-layout {
  display: grid;
  grid-template-columns: minmax(320px, 560px) minmax(220px, 1fr);
  gap: 16px;
  align-items: start;
}
.abl-board {
  display: grid;
  justify-content: center;
  gap: 5px;
  width: min(100%, 560px);
  padding: 14px;
  border: 1px solid rgba(23, 32, 29, 0.18);
  border-radius: 8px;
  background: #9ba5ad;
}
.abl-row {
  display: grid;
  grid-template-columns: repeat(var(--row-size), 44px);
  justify-content: center;
  gap: 5px;
}
.abl-cell {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  min-height: 44px;
  border: 1px solid rgba(23, 32, 29, 0.22);
  border-radius: 999px;
  background: #6f7a82;
  color: #17201d;
  padding: 0;
}
.abl-cell.selectable {
  box-shadow: inset 0 0 0 2px #28777c;
}
.abl-cell.selected {
  outline: 3px solid #d69b2d;
  outline-offset: 1px;
}
.abl-marble {
  display: grid;
  place-items: center;
  width: 78%;
  aspect-ratio: 1;
  border: 2px solid rgba(17, 24, 39, 0.26);
  border-radius: 999px;
  font-weight: 900;
}
.abl-panel {
  display: grid;
  gap: 14px;
}
.abl-players {
  display: grid;
  gap: 8px;
}
.abl-player {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 9px;
  background: #fbfcfa;
}
.abl-player strong,
.abl-player span {
  display: block;
}
.abl-player span,
.abl-controls > span {
  color: #52625d;
  font-size: 0.84rem;
}
.abl-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(23, 32, 29, 0.2);
  border-radius: 999px;
}
.abl-controls {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 10px;
  background: #fbfcfa;
}
.abl-directions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
}
.abl-directions button,
.abl-clear {
  border: 1px solid rgba(23, 32, 29, 0.16);
  border-radius: 8px;
  background: #edf2ed;
  color: #17201d;
}
.abl-directions button {
  font-weight: 900;
}
.abl-clear {
  color: white;
  background: #17201d;
}
@media (max-width: 840px) {
  .abl-layout {
    grid-template-columns: 1fr;
  }
  .abl-row {
    grid-template-columns: repeat(var(--row-size), minmax(28px, 44px));
  }
  .abl-cell {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
  }
}
`;
