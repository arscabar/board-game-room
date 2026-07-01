import { FlipHorizontal, RotateCw, SkipForward } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import type { GameComponentProps, GameModule } from "../types";

type Point = {
  x: number;
  y: number;
};

type BlokusPhase = "playing" | "finished";

type BlokusPiece = {
  id: string;
  name: string;
  cells: Point[];
};

type BlokusPlayerState = {
  id: string;
  name: string;
  color: string;
  corner: Point;
  placedPieceIds: string[];
};

type BlokusState = {
  board: Array<Array<string | null>>;
  players: BlokusPlayerState[];
  phase: BlokusPhase;
  message: string;
  winnerIds: string[];
};

type BlokusPublicPlayer = BlokusPlayerState & {
  remainingPieceIds: string[];
  placedCells: number;
  remainingCells: number;
  canMove: boolean;
};

type BlokusPublicState = {
  board: Array<Array<string | null>>;
  players: BlokusPublicPlayer[];
  phase: BlokusPhase;
  message: string;
  winnerIds: string[];
  pieceCatalog: BlokusPiece[];
};

const BOARD_SIZE = 20;

const PLAYER_COLORS = ["#2364aa", "#e0a11a", "#d94f45", "#258a5b"];

const CORNERS_BY_PLAYER_COUNT: Record<number, Point[]> = {
  2: [
    { x: 0, y: 0 },
    { x: BOARD_SIZE - 1, y: BOARD_SIZE - 1 }
  ],
  3: [
    { x: 0, y: 0 },
    { x: BOARD_SIZE - 1, y: 0 },
    { x: BOARD_SIZE - 1, y: BOARD_SIZE - 1 }
  ],
  4: [
    { x: 0, y: 0 },
    { x: BOARD_SIZE - 1, y: 0 },
    { x: BOARD_SIZE - 1, y: BOARD_SIZE - 1 },
    { x: 0, y: BOARD_SIZE - 1 }
  ]
};

// Full 21-piece Blokus catalog. Two-player games are represented as one color per player
// on opposite corners, rather than the official two-colors-per-player variant.
const PIECES: BlokusPiece[] = [
  { id: "i1", name: "1", cells: [{ x: 0, y: 0 }] },
  { id: "i2", name: "2", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
  { id: "i3", name: "I3", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] },
  { id: "v3", name: "V3", cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
  { id: "i4", name: "I4", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] },
  { id: "l4", name: "L4", cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }] },
  { id: "o4", name: "O4", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
  { id: "t4", name: "T4", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }] },
  { id: "z4", name: "Z4", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }] },
  { id: "i5", name: "I5", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }] },
  { id: "f5", name: "F", cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }] },
  { id: "l5", name: "L5", cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 1, y: 3 }] },
  { id: "n5", name: "N", cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }] },
  { id: "p5", name: "P", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }] },
  { id: "t5", name: "T5", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }] },
  { id: "u5", name: "U", cells: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] },
  { id: "v5", name: "V5", cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }] },
  { id: "w5", name: "W", cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }] },
  { id: "x5", name: "X", cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }] },
  { id: "y5", name: "Y", cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 1, y: 1 }] },
  { id: "z5", name: "Z5", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }] }
];

const EDGE_DIRECTIONS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

const CORNER_DIRECTIONS: Point[] = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 }
];

const orientationCache = new Map<string, Point[][]>();

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array<string | null>(BOARD_SIZE).fill(null));
}

function normalizeCells(cells: Point[]) {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  return cells
    .map((cell) => ({ x: cell.x - minX, y: cell.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function cellSignature(cells: Point[]) {
  return normalizeCells(cells)
    .map((cell) => `${cell.x},${cell.y}`)
    .join(";");
}

function transformCells(cells: Point[], rotation: number, flipped: boolean) {
  let transformed = cells.map((cell) => ({ x: flipped ? -cell.x : cell.x, y: cell.y }));
  for (let index = 0; index < rotation % 4; index += 1) {
    transformed = transformed.map((cell) => ({ x: -cell.y, y: cell.x }));
  }
  return normalizeCells(transformed);
}

function getPiece(pieceId: string) {
  return PIECES.find((piece) => piece.id === pieceId) ?? null;
}

function getOrientations(piece: BlokusPiece) {
  const cached = orientationCache.get(piece.id);
  if (cached) {
    return cached;
  }

  const signatures = new Set<string>();
  const orientations: Point[][] = [];
  for (const flipped of [false, true]) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const cells = transformCells(piece.cells, rotation, flipped);
      const signature = cellSignature(cells);
      if (!signatures.has(signature)) {
        signatures.add(signature);
        orientations.push(cells);
      }
    }
  }

  orientationCache.set(piece.id, orientations);
  return orientations;
}

function translateCells(cells: Point[], x: number, y: number) {
  return cells.map((cell) => ({ x: cell.x + x, y: cell.y + y }));
}

function inBounds(point: Point) {
  return point.x >= 0 && point.x < BOARD_SIZE && point.y >= 0 && point.y < BOARD_SIZE;
}

function cloneState(state: BlokusState): BlokusState {
  return {
    board: state.board.map((row) => [...row]),
    players: state.players.map((player) => ({
      ...player,
      corner: { ...player.corner },
      placedPieceIds: [...player.placedPieceIds]
    })),
    phase: state.phase,
    message: state.message,
    winnerIds: [...state.winnerIds]
  };
}

function getPlayerCellCount(board: BlokusState["board"], playerId: string) {
  return board.reduce(
    (total, row) => total + row.reduce((rowTotal, cell) => rowTotal + (cell === playerId ? 1 : 0), 0),
    0
  );
}

function getRemainingPieces(player: BlokusPlayerState) {
  const placed = new Set(player.placedPieceIds);
  return PIECES.filter((piece) => !placed.has(piece.id));
}

function getRemainingCellCount(player: BlokusPlayerState) {
  return getRemainingPieces(player).reduce((total, piece) => total + piece.cells.length, 0);
}

function getPlacementError(
  state: Pick<BlokusState, "board">,
  player: Pick<BlokusPlayerState, "id" | "corner" | "placedPieceIds">,
  pieceId: string,
  x: number,
  y: number,
  rotation: number,
  flipped: boolean
) {
  const piece = getPiece(pieceId);
  if (!piece) {
    return "알 수 없는 블록입니다.";
  }

  if (player.placedPieceIds.includes(pieceId)) {
    return "이미 사용한 블록입니다.";
  }

  const cells = translateCells(transformCells(piece.cells, rotation, flipped), x, y);
  if (cells.some((cell) => !inBounds(cell))) {
    return "보드 밖으로 나갑니다.";
  }

  if (cells.some((cell) => state.board[cell.y][cell.x] !== null)) {
    return "다른 블록과 겹칠 수 없습니다.";
  }

  const isFirstPiece = player.placedPieceIds.length === 0;
  if (isFirstPiece) {
    const coversCorner = cells.some((cell) => cell.x === player.corner.x && cell.y === player.corner.y);
    return coversCorner ? null : "첫 블록은 자기 시작 모서리를 덮어야 합니다.";
  }

  const touchesOwnEdge = cells.some((cell) =>
    EDGE_DIRECTIONS.some((direction) => state.board[cell.y + direction.y]?.[cell.x + direction.x] === player.id)
  );
  if (touchesOwnEdge) {
    return "자기 색 블록은 변으로 맞닿을 수 없습니다.";
  }

  const touchesOwnCorner = cells.some((cell) =>
    CORNER_DIRECTIONS.some((direction) => state.board[cell.y + direction.y]?.[cell.x + direction.x] === player.id)
  );
  return touchesOwnCorner ? null : "두 번째 블록부터는 자기 색 꼭짓점과 닿아야 합니다.";
}

function canPlace(
  state: Pick<BlokusState, "board">,
  player: Pick<BlokusPlayerState, "id" | "corner" | "placedPieceIds">,
  pieceId: string,
  x: number,
  y: number,
  rotation: number,
  flipped: boolean
) {
  return getPlacementError(state, player, pieceId, x, y, rotation, flipped) === null;
}

function playerCanMove(state: Pick<BlokusState, "board">, player: BlokusPlayerState) {
  for (const piece of getRemainingPieces(player)) {
    for (const orientation of getOrientations(piece)) {
      for (let y = 0; y < BOARD_SIZE; y += 1) {
        for (let x = 0; x < BOARD_SIZE; x += 1) {
          const cells = translateCells(orientation, x, y);
          if (cells.every(inBounds) && placementCellsAreLegal(state, player, piece.id, cells)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function placementCellsAreLegal(
  state: Pick<BlokusState, "board">,
  player: Pick<BlokusPlayerState, "id" | "corner" | "placedPieceIds">,
  pieceId: string,
  cells: Point[]
) {
  if (player.placedPieceIds.includes(pieceId)) {
    return false;
  }
  if (cells.some((cell) => !inBounds(cell) || state.board[cell.y][cell.x] !== null)) {
    return false;
  }
  if (player.placedPieceIds.length === 0) {
    return cells.some((cell) => cell.x === player.corner.x && cell.y === player.corner.y);
  }
  const touchesOwnEdge = cells.some((cell) =>
    EDGE_DIRECTIONS.some((direction) => state.board[cell.y + direction.y]?.[cell.x + direction.x] === player.id)
  );
  if (touchesOwnEdge) {
    return false;
  }
  return cells.some((cell) =>
    CORNER_DIRECTIONS.some((direction) => state.board[cell.y + direction.y]?.[cell.x + direction.x] === player.id)
  );
}

function finishGame(state: BlokusState) {
  const scores = state.players.map((player) => ({
    playerId: player.id,
    placedCells: getPlayerCellCount(state.board, player.id)
  }));
  const highScore = Math.max(...scores.map((score) => score.placedCells));
  const winnerIds = scores.filter((score) => score.placedCells === highScore).map((score) => score.playerId);
  state.phase = "finished";
  state.winnerIds = winnerIds;
  state.message = `게임 종료. ${highScore}칸을 배치한 플레이어가 최고점입니다.`;
  return winnerIds;
}

function getNextTurn(state: BlokusState, currentPlayerId: string, turnNumber: number, roundNumber: number) {
  const currentIndex = Math.max(
    0,
    state.players.findIndex((player) => player.id === currentPlayerId)
  );

  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const nextIndex = (currentIndex + offset) % state.players.length;
    const candidate = state.players[nextIndex];
    if (playerCanMove(state, candidate)) {
      return {
        activePlayerId: candidate.id,
        turnNumber: turnNumber + 1,
        roundNumber: roundNumber + (currentIndex + offset >= state.players.length ? 1 : 0),
        finished: false
      };
    }
  }

  return {
    activePlayerId: null,
    turnNumber,
    roundNumber,
    finished: true
  };
}

function assertBlokusState(state: unknown): BlokusState {
  if (!state || typeof state !== "object" || !Array.isArray((state as BlokusState).board)) {
    throw new Error("블로커스 상태가 올바르지 않습니다.");
  }
  return state as BlokusState;
}

function readPlacePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const pieceId = typeof record.pieceId === "string" ? record.pieceId : "";
  const x = typeof record.x === "number" && Number.isInteger(record.x) ? record.x : Number.NaN;
  const y = typeof record.y === "number" && Number.isInteger(record.y) ? record.y : Number.NaN;
  const rotation = typeof record.rotation === "number" && Number.isInteger(record.rotation) ? record.rotation : 0;
  const flipped = record.flipped === true;

  if (!pieceId || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    pieceId,
    x,
    y,
    rotation: ((rotation % 4) + 4) % 4,
    flipped
  };
}

function requireActivePlayer(state: BlokusState, currentPlayerId: string, activePlayerId: string | null) {
  if (state.phase !== "playing") {
    throw new Error("이미 종료된 게임입니다.");
  }

  if (currentPlayerId !== activePlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }

  const player = state.players.find((item) => item.id === currentPlayerId);
  if (!player) {
    throw new Error("블로커스 플레이어를 찾을 수 없습니다.");
  }
  return player;
}

export const module: GameModule = {
  id: "blokus",
  createInitialState: ({ players }) => {
    const seatedPlayers = players
      .filter((player) => player.connected)
      .sort((a, b) => a.seat - b.seat)
      .slice(0, 4);
    const corners = CORNERS_BY_PLAYER_COUNT[seatedPlayers.length] ?? CORNERS_BY_PLAYER_COUNT[4];

    return {
      board: createBoard(),
      players: seatedPlayers.map((player, index) => ({
        id: player.id,
        name: player.name,
        color: PLAYER_COLORS[index],
        corner: corners[index],
        placedPieceIds: []
      })),
      phase: "playing",
      message: "첫 블록은 자기 시작 모서리를 덮어야 합니다.",
      winnerIds: []
    } satisfies BlokusState;
  },
  getPublicState: (state) => {
    const blokusState = assertBlokusState(state);
    return {
      board: blokusState.board,
      players: blokusState.players.map((player) => ({
        ...player,
        placedPieceIds: [...player.placedPieceIds],
        remainingPieceIds: getRemainingPieces(player).map((piece) => piece.id),
        placedCells: getPlayerCellCount(blokusState.board, player.id),
        remainingCells: getRemainingCellCount(player),
        canMove: blokusState.phase === "playing" && playerCanMove(blokusState, player)
      })),
      phase: blokusState.phase,
      message: blokusState.message,
      winnerIds: [...blokusState.winnerIds],
      pieceCatalog: PIECES
    } satisfies BlokusPublicState;
  },
  applyAction: (state, action, context) => {
    const currentState = assertBlokusState(state);
    const nextState = cloneState(currentState);
    const player = requireActivePlayer(nextState, context.currentPlayerId, context.activePlayerId);

    if (action.type === "pass") {
      if (playerCanMove(nextState, player)) {
        throw new Error("둘 수 있는 블록이 남아 있어 패스할 수 없습니다.");
      }
      const turn = getNextTurn(nextState, player.id, context.turnNumber, context.roundNumber);
      if (turn.finished) {
        const winnerIds = finishGame(nextState);
        return {
          state: nextState,
          log: `${player.name} 패스. 블로커스 종료`,
          activePlayerId: null,
          phase: nextState.phase,
          message: nextState.message,
          winnerId: winnerIds.length === 1 ? winnerIds[0] : null
        };
      }
      nextState.message = `${player.name}님은 둘 수 있는 블록이 없어 패스했습니다.`;
      return {
        state: nextState,
        log: `${player.name} 패스`,
        activePlayerId: turn.activePlayerId,
        turnNumber: turn.turnNumber,
        roundNumber: turn.roundNumber,
        phase: nextState.phase,
        message: nextState.message
      };
    }

    if (action.type !== "place-piece") {
      throw new Error("지원하지 않는 블로커스 행동입니다.");
    }

    const payload = readPlacePayload(action.payload);
    if (!payload) {
      throw new Error("블록 배치 정보가 올바르지 않습니다.");
    }

    const error = getPlacementError(
      nextState,
      player,
      payload.pieceId,
      payload.x,
      payload.y,
      payload.rotation,
      payload.flipped
    );
    if (error) {
      throw new Error(error);
    }

    const piece = getPiece(payload.pieceId);
    if (!piece) {
      throw new Error("알 수 없는 블록입니다.");
    }
    const cells = translateCells(transformCells(piece.cells, payload.rotation, payload.flipped), payload.x, payload.y);
    for (const cell of cells) {
      nextState.board[cell.y][cell.x] = player.id;
    }
    player.placedPieceIds.push(piece.id);

    const turn = getNextTurn(nextState, player.id, context.turnNumber, context.roundNumber);
    if (turn.finished) {
      const winnerIds = finishGame(nextState);
      return {
        state: nextState,
        log: `${player.name} ${piece.name} 배치. 블로커스 종료`,
        activePlayerId: null,
        phase: nextState.phase,
        message: nextState.message,
        winnerId: winnerIds.length === 1 ? winnerIds[0] : null
      };
    }

    const nextPlayer = nextState.players.find((item) => item.id === turn.activePlayerId);
    nextState.message = `${player.name}님이 ${piece.name} 블록을 놓았습니다. ${nextPlayer?.name ?? "다음 플레이어"} 차례입니다.`;
    return {
      state: nextState,
      log: `${player.name} ${piece.name} 배치`,
      activePlayerId: turn.activePlayerId,
      turnNumber: turn.turnNumber,
      roundNumber: turn.roundNumber,
      phase: nextState.phase,
      message: nextState.message
    };
  }
};

function isBlokusPublicState(state: unknown): state is BlokusPublicState {
  return Boolean(state && typeof state === "object" && Array.isArray((state as BlokusPublicState).board));
}

function PieceMini({ piece, color }: { piece: BlokusPiece; color: string }) {
  const cells = normalizeCells(piece.cells);
  const width = Math.max(...cells.map((cell) => cell.x)) + 1;
  const height = Math.max(...cells.map((cell) => cell.y)) + 1;
  const occupied = new Set(cells.map((cell) => `${cell.x},${cell.y}`));

  return (
    <span
      className="blokus-piece-mini"
      style={{
        "--piece-color": color,
        "--piece-width": width,
        "--piece-height": height
      } as CSSProperties}
      aria-hidden="true"
    >
      {Array.from({ length: width * height }, (_, index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        return <span key={`${x}-${y}`} className={occupied.has(`${x},${y}`) ? "filled" : ""} />;
      })}
    </span>
  );
}

function BlokusStyles() {
  return (
    <style>{`
      .blokus-module {
        display: grid;
        gap: 1rem;
        color: #172033;
        background:
          linear-gradient(135deg, rgba(35, 100, 170, 0.08), transparent 38%),
          #f7fbff;
      }

      .blokus-status {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.75rem;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: linear-gradient(180deg, #ffffff, #e7f0fb);
      }

      .blokus-status strong {
        font-size: 1rem;
      }

      .blokus-layout {
        display: grid;
        grid-template-columns: minmax(300px, 1fr) 280px;
        gap: 1rem;
        align-items: start;
      }

      .blokus-board {
        display: grid;
        grid-template-columns: repeat(20, minmax(10px, 1fr));
        width: min(100%, 680px);
        border: 1px solid rgba(35, 100, 170, 0.28);
        background:
          linear-gradient(180deg, #ffffff, #dfe9f6);
        border-radius: 8px;
        overflow: hidden;
        box-shadow:
          inset 0 0 0 5px rgba(255, 255, 255, 0.82),
          0 14px 26px rgba(35, 100, 170, 0.13);
      }

      .blokus-cell {
        position: relative;
        aspect-ratio: 1;
        min-width: 0;
        border: 0;
        border-right: 1px solid rgba(35, 100, 170, 0.12);
        border-bottom: 1px solid rgba(35, 100, 170, 0.12);
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.35), transparent 45%),
          var(--cell-color, #f8fafc);
        cursor: pointer;
      }

      .blokus-cell[style*="--cell-color"] {
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.42),
          inset 0 -3px 0 rgba(15, 23, 42, 0.12);
      }

      .blokus-cell:disabled {
        cursor: default;
      }

      .blokus-cell.corner::after {
        content: "";
        position: absolute;
        inset: 23%;
        border: 2px solid rgba(35, 100, 170, 0.4);
        border-radius: 50%;
      }

      .blokus-cell.preview {
        background: color-mix(in srgb, var(--preview-color) 58%, #ffffff);
      }

      .blokus-cell.preview.invalid {
        background: #f7c2c2;
      }

      .blokus-cell.preview::before {
        content: "";
        position: absolute;
        inset: 2px;
        border: 2px dashed rgba(15, 23, 42, 0.36);
        border-radius: 3px;
      }

      .blokus-side {
        display: grid;
        gap: 0.9rem;
      }

      .blokus-controls,
      .blokus-scoreboard,
      .blokus-palette {
        display: grid;
        gap: 0.65rem;
        border: 1px solid rgba(35, 100, 170, 0.14);
        border-radius: 8px;
        padding: 0.75rem;
        background: linear-gradient(180deg, #ffffff, #e8f1fb);
      }

      .blokus-controls-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.45rem;
      }

      .blokus-controls button,
      .blokus-palette button {
        min-height: 2.35rem;
        border: 1px solid rgba(35, 100, 170, 0.18);
        border-radius: 8px;
        background: linear-gradient(180deg, #ffffff, #edf5ff);
        color: #172033;
        font: inherit;
        cursor: pointer;
      }

      .blokus-controls button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
      }

      .blokus-controls button:disabled,
      .blokus-palette button:disabled {
        cursor: default;
        opacity: 0.48;
      }

      .blokus-palette-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.45rem;
      }

      .blokus-palette button {
        display: grid;
        place-items: center;
        gap: 0.2rem;
        padding: 0.45rem 0.25rem;
      }

      .blokus-palette button.selected {
        border-color: var(--player-color);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--player-color) 28%, transparent);
      }

      .blokus-piece-mini {
        display: grid;
        grid-template-columns: repeat(var(--piece-width), 0.42rem);
        grid-template-rows: repeat(var(--piece-height), 0.42rem);
        gap: 1px;
        min-height: calc(var(--piece-height) * 0.42rem);
      }

      .blokus-piece-mini span {
        width: 0.42rem;
        height: 0.42rem;
      }

      .blokus-piece-mini .filled {
        background: var(--piece-color);
        border-radius: 2px;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.45),
          inset 0 -2px 0 rgba(15, 23, 42, 0.16);
      }

      .blokus-player-row {
        display: grid;
        grid-template-columns: 0.85rem 1fr auto;
        align-items: center;
        gap: 0.5rem;
        padding: 0.45rem 0;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }

      .blokus-player-row .swatch {
        width: 0.85rem;
        height: 0.85rem;
        border-radius: 50%;
        background: var(--player-color);
      }

      .blokus-player-row.active strong {
        color: var(--player-color);
      }

      .blokus-empty {
        padding: 1rem;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 8px;
        background: #ffffff;
      }

      @media (max-width: 860px) {
        .blokus-layout {
          grid-template-columns: 1fr;
        }

        .blokus-board {
          width: 100%;
        }
      }
    `}</style>
  );
}

export function Component({
  publicState,
  currentPlayer,
  activePlayer,
  disabled,
  onAction
}: GameComponentProps<BlokusPublicState>) {
  const [selectedPieceId, setSelectedPieceId] = useState(PIECES[0].id);
  const [rotation, setRotation] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<Point | null>(null);
  const state = isBlokusPublicState(publicState) ? publicState : null;
  const currentBlokusPlayer = state?.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const activeBlokusPlayer = state?.players.find((player) => player.id === activePlayer?.id) ?? null;
  const canInteract =
    !disabled &&
    state?.phase === "playing" &&
    Boolean(currentBlokusPlayer) &&
    currentBlokusPlayer?.id === activeBlokusPlayer?.id;
  const selectedPiece =
    state?.pieceCatalog.find((piece) => piece.id === selectedPieceId && currentBlokusPlayer?.remainingPieceIds.includes(piece.id)) ??
    state?.pieceCatalog.find((piece) => currentBlokusPlayer?.remainingPieceIds.includes(piece.id)) ??
    null;
  const preview = useMemo(() => {
    if (!state || !hoveredCell || !selectedPiece || !currentBlokusPlayer) {
      return { cells: new Set<string>(), valid: false };
    }
    const cells = translateCells(transformCells(selectedPiece.cells, rotation, flipped), hoveredCell.x, hoveredCell.y);
    const valid =
      cells.every(inBounds) &&
      placementCellsAreLegal(state, currentBlokusPlayer, selectedPiece.id, cells);
    return {
      cells: new Set(cells.map((cell) => `${cell.x},${cell.y}`)),
      valid
    };
  }, [currentBlokusPlayer, flipped, hoveredCell, state, rotation, selectedPiece]);

  if (!state) {
    return (
      <div className="blokus-module">
        <BlokusStyles />
        <div className="blokus-empty">블로커스 상태를 불러오는 중입니다.</div>
      </div>
    );
  }

  function placeAt(point: Point) {
    if (!canInteract || !selectedPiece) {
      return;
    }
    onAction({
      type: "place-piece",
      payload: {
        pieceId: selectedPiece.id,
        x: point.x,
        y: point.y,
        rotation,
        flipped
      }
    });
  }

  return (
    <div className="blokus-module">
      <BlokusStyles />
      <div className="blokus-status">
        <div>
          <strong>{state.phase === "finished" ? "게임 종료" : `${activeBlokusPlayer?.name ?? "대기"} 차례`}</strong>
          <div>{state.message}</div>
        </div>
        {currentBlokusPlayer ? (
          <span style={{ color: currentBlokusPlayer.color }}>
            내 남은 칸 {currentBlokusPlayer.remainingCells}
          </span>
        ) : null}
      </div>

      <div className="blokus-layout">
        <div className="blokus-board" onMouseLeave={() => setHoveredCell(null)} aria-label="블로커스 20x20 보드">
          {state.board.flatMap((row, y) =>
            row.map((ownerId, x) => {
              const owner = state.players.find((player) => player.id === ownerId);
              const cornerOwner = state.players.find((player) => player.corner.x === x && player.corner.y === y);
              const key = `${x},${y}`;
              const isPreview = preview.cells.has(key);
              return (
                <button
                  key={key}
                  className={[
                    "blokus-cell",
                    cornerOwner ? "corner" : "",
                    isPreview ? "preview" : "",
                    isPreview && !preview.valid ? "invalid" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  disabled={!canInteract}
                  onClick={() => placeAt({ x, y })}
                  onFocus={() => setHoveredCell({ x, y })}
                  onMouseEnter={() => setHoveredCell({ x, y })}
                  style={{
                    "--cell-color": owner?.color ?? "#f8fafc",
                    "--preview-color": currentBlokusPlayer?.color ?? "#94a3b8"
                  } as CSSProperties}
                  title={`${x + 1}, ${y + 1}${cornerOwner ? ` · ${cornerOwner.name} 시작 모서리` : ""}`}
                  aria-label={`${x + 1}열 ${y + 1}행`}
                />
              );
            })
          )}
        </div>

        <aside className="blokus-side" aria-label="블로커스 조작">
          <section className="blokus-controls">
            <strong>블록 조작</strong>
            <div className="blokus-controls-row">
              <button type="button" onClick={() => setRotation((value) => (value + 1) % 4)} disabled={!canInteract}>
                <RotateCw size={16} />
                회전
              </button>
              <button type="button" onClick={() => setFlipped((value) => !value)} disabled={!canInteract}>
                <FlipHorizontal size={16} />
                뒤집기
              </button>
              <button
                type="button"
                onClick={() => onAction({ type: "pass" })}
                disabled={!canInteract || currentBlokusPlayer?.canMove !== false}
                title="합법적으로 놓을 블록이 없을 때만 패스할 수 있습니다."
              >
                <SkipForward size={16} />
                패스
              </button>
            </div>
          </section>

          <section className="blokus-palette" style={{ "--player-color": currentBlokusPlayer?.color ?? "#64748b" } as CSSProperties}>
            <strong>남은 블록</strong>
            <div className="blokus-palette-grid">
              {state.pieceCatalog.map((piece) => {
                const available = Boolean(currentBlokusPlayer?.remainingPieceIds.includes(piece.id));
                return (
                  <button
                    key={piece.id}
                    className={selectedPiece?.id === piece.id ? "selected" : ""}
                    type="button"
                    disabled={!available}
                    onClick={() => setSelectedPieceId(piece.id)}
                  >
                    <PieceMini piece={piece} color={currentBlokusPlayer?.color ?? "#64748b"} />
                    <span>{piece.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="blokus-scoreboard" aria-label="점수">
            <strong>점수</strong>
            {state.players.map((player) => (
              <div
                key={player.id}
                className={`blokus-player-row ${player.id === activeBlokusPlayer?.id ? "active" : ""}`}
                style={{ "--player-color": player.color } as CSSProperties}
              >
                <span className="swatch" aria-hidden="true" />
                <strong>{player.name}</strong>
                <span>{player.placedCells}칸</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
