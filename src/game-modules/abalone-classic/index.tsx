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
  { id: "E", label: "→", q: 1, r: 0 },
  { id: "W", label: "←", q: -1, r: 0 },
  { id: "SE", label: "↘", q: 0, r: 1 },
  { id: "NW", label: "↖", q: 0, r: -1 },
  { id: "SW", label: "↙", q: -1, r: 1 },
  { id: "NE", label: "↗", q: 1, r: -1 }
];

const directionPadOrder = ["NW", "NE", "W", "E", "SW", "SE"];

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
    throw new Error("이미 종료된 게임입니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("아발론 플레이어를 찾을 수 없습니다.");
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
    message: "구슬 1개만 선택해도 이동할 수 있습니다. 밀기는 2개 이상이 상대보다 많을 때 가능합니다."
  };
}

function moveBroadside(state: AbaloneState, player: AbalonePlayer, cells: Coord[], direction: Direction) {
  for (const cell of cells) {
    const target = add(cell, direction);
    if (!inBoard(target) || ownerAt(state, target)) {
      throw new Error("옆으로 이동하려면 모든 도착 칸이 보드 안의 빈칸이어야 합니다.");
    }
  }

  const next = cloneState(state);
  for (const cell of cells) delete next.marbles[key(cell)];
  for (const cell of cells) next.marbles[key(add(cell, direction))] = player.id;
  next.message = `${player.name}님이 구슬 ${cells.length}개를 ${direction.label} 방향으로 이동했습니다.`;
  return next;
}

function moveInline(state: AbaloneState, player: AbalonePlayer, cells: Coord[], direction: Direction) {
  const ordered = orderAlongMove(cells, direction);
  const front = ordered[ordered.length - 1];
  const firstTarget = add(front, direction);

  if (!inBoard(firstTarget)) {
    throw new Error("자기 구슬을 보드 밖으로 밀 수 없습니다.");
  }

  const firstOwner = ownerAt(state, firstTarget);
  const next = cloneState(state);

  if (!firstOwner) {
    for (const cell of ordered) delete next.marbles[key(cell)];
    for (const cell of ordered) next.marbles[key(add(cell, direction))] = player.id;
    next.message = `${player.name}님이 구슬 ${ordered.length}개를 ${direction.label} 방향으로 이동했습니다.`;
    return next;
  }

  if (firstOwner === player.id) {
    throw new Error("자기 구슬이 앞을 막고 있습니다.");
  }

  const opponents: Coord[] = [];
  let cursor = firstTarget;
  while (inBoard(cursor)) {
    const owner = ownerAt(state, cursor);
    if (!owner) break;
    if (owner === player.id) {
      throw new Error("상대 구슬 뒤에 자기 구슬이 있어 밀 수 없습니다.");
    }
    opponents.push(cursor);
    cursor = add(cursor, direction);
  }

  if (opponents.length === 0 || opponents.length >= ordered.length) {
    throw new Error("상대 구슬보다 더 많은 구슬로 밀어야 합니다.");
  }

  const landingIsBoard = inBoard(cursor);
  if (landingIsBoard && ownerAt(state, cursor)) {
    throw new Error("밀린 구슬이 갈 빈칸이 없습니다.");
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
    ? `${player.name}님이 상대 구슬 ${opponents.length}개를 밀었습니다.`
    : `${player.name}님이 상대 구슬 1개를 보드 밖으로 밀었습니다.`;
  return next;
}

function applyMove(state: AbaloneState, action: GameAction, context: GameContext): GameActionResult {
  if (!isMovePayload(action.payload)) {
    throw new Error("이동할 구슬과 방향이 필요합니다.");
  }

  const player = requireActivePlayer(state, context);
  const direction = directionById(action.payload.direction);
  if (!direction) {
    throw new Error("알 수 없는 이동 방향입니다.");
  }

  const cells = action.payload.cells;
  const uniqueKeys = new Set(cells.map(key));
  if (cells.length < 1 || cells.length > 3 || uniqueKeys.size !== cells.length) {
    throw new Error("서로 다른 구슬 1~3개를 선택하세요.");
  }
  for (const cell of cells) {
    if (!inBoard(cell) || ownerAt(state, cell) !== player.id) {
      throw new Error("자기 구슬만 선택할 수 있습니다.");
    }
  }
  if (!isSelectionLine(cells)) {
    throw new Error("선택한 구슬은 서로 붙어 있고 한 줄이어야 합니다.");
  }

  const axis = selectionAxis(cells);
  const next = inlineWith(axis, direction)
    ? moveInline(state, player, cells, direction)
    : moveBroadside(state, player, cells, direction);

  if ((next.pushedOff[player.id] ?? 0) >= WIN_PUSHES) {
    next.winnerId = player.id;
    next.message = `${player.name}님이 상대 구슬 6개를 밀어내 승리했습니다.`;
    return {
      state: next,
      log: `${player.name} 구슬 6개 밀어내기 승리`,
      activePlayerId: null,
      winnerId: player.id,
      message: next.message
    };
  }

  return {
    state: next,
    log: `${player.name} 구슬 ${cells.length}개 ${direction.label} 이동`,
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
    throw new Error("지원하지 않는 아발론 행동입니다.");
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

function lineBetweenEndpoints(start: Coord, end: Coord) {
  if (sameCoord(start, end)) return [start];

  for (const direction of directions) {
    const line: Coord[] = [start];
    let cursor = start;
    for (let distance = 1; distance <= 2; distance += 1) {
      cursor = add(cursor, direction);
      line.push(cursor);
      if (sameCoord(cursor, end)) return line;
    }
  }

  return null;
}

function selectionFromEndpoints(
  state: AbalonePublicState,
  playerId: string | undefined,
  start: Coord,
  end: Coord
) {
  if (!playerId || ownerAt(state, start) !== playerId || ownerAt(state, end) !== playerId) return null;
  const line = lineBetweenEndpoints(start, end);
  if (!line || line.length > 3) return null;
  return line.every((coord) => ownerAt(state, coord) === playerId) ? line : null;
}

function selectionCanEndAt(state: AbalonePublicState, playerId: string | undefined, selection: Coord[], coord: Coord) {
  if (!playerId || ownerAt(state, coord) !== playerId) return false;
  if (selection.length === 0) return true;
  return Boolean(selectionFromEndpoints(state, playerId, selection[0], coord));
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
  const directionPad = useMemo(
    () => directionPadOrder.map((directionId) => directionById(directionId)).filter(Boolean) as Direction[],
    []
  );
  const selectionHint = !canAct
    ? "현재 차례가 되면 자기 구슬을 선택할 수 있습니다."
    : selection.length === 0
      ? "시작 구슬을 선택하세요. 구슬 1개만 선택한 상태에서도 바로 이동할 수 있습니다."
      : !validSelection
        ? "선택한 구슬은 한 줄로 이어져야 합니다."
        : selection.length === 1
          ? "끝 구슬을 고르면 사이 구슬이 자동 선택됩니다. 또는 바로 방향을 눌러 1개를 이동하세요."
          : selection.length === 2
            ? "시작점부터 끝점까지 2개가 선택되었습니다. 상대 구슬 1개까지 밀 수 있습니다."
            : "시작점부터 끝점까지 3개가 선택되었습니다. 상대 구슬 1~2개까지 밀 수 있습니다.";

  function chooseSelectionEndpoint(coord: Coord) {
    if (!canAct) return;
    if (!currentPlayer?.id || ownerAt(publicState, coord) !== currentPlayer.id) return;
    if (selection.length === 0) {
      setSelection([coord]);
      return;
    }

    const nextSelection = selectionFromEndpoints(publicState, currentPlayer.id, selection[0], coord);
    if (nextSelection) {
      setSelection(nextSelection);
      return;
    }

    setSelection([coord]);
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
          <strong>{publicState.winnerId ? "승자" : "차례"}</strong>
          <span>
            {publicState.winnerId
              ? publicState.players.find((player) => player.id === publicState.winnerId)?.name
              : activeModulePlayer?.name ?? "대기"}
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
                  const ownSelectable = canAct && owner === currentPlayer?.id;
                  const endpoint = canAct && selectionCanEndAt(publicState, currentPlayer?.id, selection, coord);
                  const anchor = selection.length > 0 && sameCoord(selection[0], coord);
                  const color = ownerColor(publicState, owner);
                  return (
                    <button
                      className={`abl-cell ${selected ? "selected" : ""} ${anchor ? "anchor" : ""} ${
                        ownSelectable ? "selectable" : ""
                      } ${endpoint ? "endpoint" : ""}`}
                      disabled={!ownSelectable}
                      key={key(coord)}
                      onClick={() => chooseSelectionEndpoint(coord)}
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
          <div className="abl-controls">
            <div className="abl-control-head">
              <strong>이동/밀기</strong>
              <span>{selection.length}/3 선택</span>
            </div>
            <p className={validSelection ? "abl-selection-guide ready" : "abl-selection-guide"}>{selectionHint}</p>
            <div className="abl-direction-pad" aria-label="이동 또는 밀기 방향">
              {directionPad.map((direction) => (
                <button
                  aria-label={`${direction.id} 방향으로 이동 또는 밀기`}
                  className={`abl-dir-button dir-${direction.id}`}
                  disabled={!canAct || !validSelection}
                  key={direction.id}
                  onClick={() => sendMove(direction)}
                  title={`${direction.id} 방향으로 이동 또는 밀기`}
                  type="button"
                >
                  <span aria-hidden="true">{direction.label}</span>
                </button>
              ))}
              <div className="abl-pad-center" aria-hidden="true">
                {selection.length === 0 ? "선택" : `${selection.length}`}
              </div>
            </div>
            <button className="abl-clear" disabled={selection.length === 0} onClick={() => setSelection([])} type="button">
              선택 취소
            </button>
          </div>

          <div className="abl-players">
            {publicState.players.map((player) => (
              <div className="abl-player" key={player.id}>
                <span className="abl-swatch" style={{ background: player.color }} />
                <div>
                  <strong>{player.name}</strong>
                  <span>밀어낸 구슬 {publicState.pushedOff[player.id] ?? 0}/6</span>
                </div>
              </div>
            ))}
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
  border: 1px solid rgba(31, 41, 55, 0.18);
  border-radius: 8px;
  padding: 12px;
  background:
    linear-gradient(180deg, #f7f8f8, #d9dee2);
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
  min-width: 0;
}
.abl-board {
  --abl-cell-size: 44px;
  display: grid;
  justify-content: center;
  gap: 4px;
  width: min(100%, 560px);
  padding: 18px;
  border: 1px solid rgba(15, 23, 42, 0.34);
  border-radius: 8px;
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.18), transparent 24%),
    linear-gradient(145deg, #8b949b, #4e5962 58%, #303943);
  box-shadow:
    inset 0 0 0 5px rgba(255, 255, 255, 0.12),
    inset 0 0 28px rgba(0, 0, 0, 0.26),
    0 16px 28px rgba(15, 23, 42, 0.18);
}
.abl-row {
  display: grid;
  grid-template-columns: repeat(var(--row-size), var(--abl-cell-size));
  justify-content: center;
  gap: 5px;
}
.abl-cell {
  display: grid;
  place-items: center;
  width: var(--abl-cell-size);
  height: var(--abl-cell-size);
  min-height: var(--abl-cell-size);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background:
    radial-gradient(circle at 45% 38%, #5a646d 0 38%, #303943 71%);
  color: #17201d;
  padding: 0;
  box-shadow:
    inset 0 4px 9px rgba(0, 0, 0, 0.42),
    inset 0 -2px 4px rgba(255, 255, 255, 0.12);
}
.abl-cell.selectable {
  cursor: pointer;
}
.abl-cell.endpoint {
  box-shadow:
    inset 0 0 0 2px #28777c,
    0 0 0 2px rgba(40, 119, 124, 0.16);
}
.abl-cell.selected {
  outline: 3px solid #d69b2d;
  outline-offset: 1px;
}
.abl-cell.anchor {
  outline-color: #f0b94f;
}
.abl-marble {
  display: grid;
  place-items: center;
  width: 78%;
  aspect-ratio: 1;
  border: 2px solid rgba(17, 24, 39, 0.26);
  border-radius: 999px;
  font-weight: 900;
  box-shadow:
    inset 0 8px 10px rgba(255, 255, 255, 0.34),
    inset 0 -10px 12px rgba(0, 0, 0, 0.24),
    0 6px 9px rgba(0, 0, 0, 0.28);
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
  background: linear-gradient(180deg, #fbfcfa, #edf1f3);
}
.abl-player strong,
.abl-player span {
  display: block;
}
.abl-player span,
.abl-control-head span {
  color: #52625d;
  font-size: 0.84rem;
}
.abl-selection-guide {
  margin: 0;
  border: 1px solid rgba(31, 41, 55, 0.14);
  border-radius: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.62);
  color: #374151;
  font-size: 0.86rem;
  line-height: 1.4;
}
.abl-selection-guide.ready {
  border-color: rgba(40, 119, 124, 0.28);
  background: rgba(232, 247, 242, 0.76);
  color: #155252;
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
  background:
    linear-gradient(180deg, #fbfcfa, #e3e8eb);
}
.abl-control-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.abl-direction-pad {
  display: grid;
  grid-template-columns: repeat(3, minmax(52px, 1fr));
  grid-template-rows: repeat(3, 52px);
  gap: 7px;
  width: min(100%, 250px);
  margin: 0 auto;
}
.abl-dir-button,
.abl-clear {
  border: 1px solid rgba(31, 41, 55, 0.2);
  border-radius: 8px;
  background: linear-gradient(180deg, #ffffff, #d8dee3);
  color: #17201d;
}
.abl-dir-button {
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 52px;
  padding: 0;
  font-weight: 900;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.62),
    0 2px 0 rgba(31, 41, 55, 0.1);
}
.abl-dir-button span {
  font-size: 1.35rem;
  line-height: 1;
}
.abl-dir-button:disabled {
  opacity: 0.45;
}
.abl-dir-button.dir-NW {
  grid-column: 1;
  grid-row: 1;
}
.abl-dir-button.dir-NE {
  grid-column: 3;
  grid-row: 1;
}
.abl-dir-button.dir-W {
  grid-column: 1;
  grid-row: 2;
}
.abl-dir-button.dir-E {
  grid-column: 3;
  grid-row: 2;
}
.abl-dir-button.dir-SW {
  grid-column: 1;
  grid-row: 3;
}
.abl-dir-button.dir-SE {
  grid-column: 3;
  grid-row: 3;
}
.abl-pad-center {
  display: grid;
  place-items: center;
  grid-column: 2;
  grid-row: 2;
  border: 1px solid rgba(31, 41, 55, 0.12);
  border-radius: 999px;
  background:
    radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.84), transparent 35%),
    linear-gradient(180deg, #f4f5f2, #ccd4d8);
  color: #52625d;
  font-size: 0.82rem;
  font-weight: 900;
}
.abl-clear {
  color: white;
  background: linear-gradient(180deg, #4b5563, #17201d);
}
@media (max-width: 840px) {
  .abl-layout {
    grid-template-columns: 1fr;
  }
  .abl-panel {
    order: -1;
  }
  .abl-board {
    --abl-cell-size: clamp(30px, calc((100vw - 88px) / 9), 42px);
    justify-content: center;
    max-width: 100%;
    overflow-x: hidden;
    padding: 12px;
  }
  .abl-row {
    grid-template-columns: repeat(var(--row-size), var(--abl-cell-size));
  }
  .abl-cell {
    width: var(--abl-cell-size);
    height: var(--abl-cell-size);
    min-height: var(--abl-cell-size);
  }
  .abl-direction-pad {
    grid-template-rows: repeat(3, 48px);
    width: min(100%, 230px);
  }
  .abl-dir-button {
    min-height: 48px;
  }
}
`;
