import { FlipHorizontal, RotateCw, SkipForward } from "lucide-react";
import { type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";
import { useInteractionGate } from "../useInteractionGate";

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
  ownerId: string;
  ownerName: string;
  scoreOwnerId: string | null;
  name: string;
  color: string;
  colorName: string;
  shared: boolean;
  corner: Point;
  placedPieceIds: string[];
};

type BlokusState = {
  board: Array<Array<string | null>>;
  players: BlokusPlayerState[];
  sharedControllers: Array<{ id: string; name: string }>;
  sharedControllerIndex: number;
  activeColorId: string | null;
  phase: BlokusPhase;
  message: string;
  winnerIds: string[];
};

type BlokusPublicPlayer = BlokusPlayerState & {
  remainingPieceIds: string[];
  placedCells: number;
  remainingCells: number;
  score: number;
  canMove: boolean;
};

type BlokusPublicState = {
  board: Array<Array<string | null>>;
  players: BlokusPublicPlayer[];
  sharedControllers: Array<{ id: string; name: string }>;
  sharedControllerIndex: number;
  activeColorId: string | null;
  phase: BlokusPhase;
  message: string;
  winnerIds: string[];
  pieceCatalog: BlokusPiece[];
};

const BOARD_SIZE = 20;

const PLAYER_COLORS = ["#2364aa", "#e0a11a", "#d94f45", "#258a5b"];
const COLOR_NAMES = ["파랑", "노랑", "빨강", "초록"];

function pieceDisplayName(piece: BlokusPiece) {
  return `${piece.cells.length}칸 조각`;
}

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

// Full 21-piece Blokus catalog. In two-player games, each player controls two opposite colors.
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
    sharedControllers: state.sharedControllers.map((controller) => ({ ...controller })),
    sharedControllerIndex: state.sharedControllerIndex,
    activeColorId: state.activeColorId,
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

function scoreForColor(player: BlokusPlayerState) {
  const remaining = getRemainingCellCount(player);
  if (remaining > 0) {
    return -remaining;
  }
  return 15 + (player.placedPieceIds[player.placedPieceIds.length - 1] === "i1" ? 5 : 0);
}

function controllerName(player: BlokusPlayerState) {
  return player.shared ? `${player.name} (${player.ownerName} 담당)` : player.name;
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

function getCandidateAnchors(state: Pick<BlokusState, "board">, player: Pick<BlokusPlayerState, "id" | "corner" | "placedPieceIds">) {
  if (player.placedPieceIds.length === 0) {
    return [player.corner];
  }

  const anchors = new Map<string, Point>();
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (state.board[y][x] !== player.id) {
        continue;
      }
      for (const direction of CORNER_DIRECTIONS) {
        const anchor = { x: x + direction.x, y: y + direction.y };
        if (!inBounds(anchor) || state.board[anchor.y][anchor.x] !== null) {
          continue;
        }
        const touchesOwnEdge = EDGE_DIRECTIONS.some(
          (edgeDirection) => state.board[anchor.y + edgeDirection.y]?.[anchor.x + edgeDirection.x] === player.id
        );
        if (!touchesOwnEdge) {
          anchors.set(`${anchor.x},${anchor.y}`, anchor);
        }
      }
    }
  }
  return [...anchors.values()];
}

function playerCanMove(state: Pick<BlokusState, "board">, player: BlokusPlayerState) {
  const anchors = getCandidateAnchors(state, player);
  for (const piece of getRemainingPieces(player)) {
    for (const orientation of getOrientations(piece)) {
      for (const anchor of anchors) {
        for (const orientationCell of orientation) {
          const cells = translateCells(orientation, anchor.x - orientationCell.x, anchor.y - orientationCell.y);
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
  const scores = new Map<string, number>();
  for (const player of state.players) {
    if (!player.scoreOwnerId) {
      continue;
    }
    scores.set(player.scoreOwnerId, (scores.get(player.scoreOwnerId) ?? 0) + scoreForColor(player));
  }
  const highScore = Math.max(...scores.values());
  const winnerIds = [...scores.entries()].filter(([, score]) => score === highScore).map(([ownerId]) => ownerId);
  state.phase = "finished";
  state.activeColorId = null;
  state.winnerIds = winnerIds;
  state.message = `게임 종료. 공식 점수 ${highScore}점 플레이어가 최고점입니다.`;
  return winnerIds;
}

function getNextTurn(state: BlokusState, currentColorId: string, turnNumber: number, roundNumber: number) {
  const currentIndex = Math.max(
    0,
    state.players.findIndex((player) => player.id === currentColorId)
  );

  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const nextIndex = (currentIndex + offset) % state.players.length;
    const candidate = state.players[nextIndex];
    if (playerCanMove(state, candidate)) {
      return {
        activeColorId: candidate.id,
        activePlayerId: candidate.ownerId,
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

function passBlokusTurn(
  currentState: BlokusState,
  context: GameContext,
  options: { requireNoMoves: boolean; timeout: boolean }
): GameActionResult {
  const nextState = cloneState(currentState);
  const player = requireActivePlayer(nextState, context.currentPlayerId, context.activePlayerId);
  if (options.requireNoMoves && playerCanMove(nextState, player)) {
    throw new Error("둘 수 있는 블록이 남아 있어 패스할 수 없습니다.");
  }

  const actingName = controllerName(player);
  advanceSharedController(nextState, player);
  const turn = getNextTurn(nextState, player.id, context.turnNumber, context.roundNumber);
  if (turn.finished) {
    const winnerIds = finishGame(nextState);
    return {
      state: nextState,
      log: options.timeout ? `${actingName} 시간 초과. 블로커스 종료` : `${actingName} 패스. 블로커스 종료`,
      activePlayerId: null,
      phase: nextState.phase,
      message: nextState.message,
      winnerId: winnerIds.length === 1 ? winnerIds[0] : null
    };
  }

  nextState.message = options.timeout
    ? `${actingName}님이 제한 시간을 넘겨 차례가 넘어갔습니다.`
    : `${actingName}님은 둘 수 있는 블록이 없어 패스했습니다.`;
  nextState.activeColorId = turn.activeColorId ?? null;
  return {
    state: nextState,
    log: options.timeout ? `${actingName} 시간 초과` : `${actingName} 패스`,
    activePlayerId: turn.activePlayerId,
    turnNumber: turn.turnNumber,
    roundNumber: turn.roundNumber,
    phase: nextState.phase,
    message: nextState.message
  };
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

  const player = state.players.find((item) => item.id === state.activeColorId);
  if (!player) {
    throw new Error("블로커스 색상 차례를 찾을 수 없습니다.");
  }
  if (player.ownerId !== currentPlayerId) {
    throw new Error("현재 색상을 담당한 플레이어만 행동할 수 있습니다.");
  }
  return player;
}

function assignSharedController(state: BlokusState) {
  const sharedPlayer = state.players.find((player) => player.shared);
  if (!sharedPlayer || state.sharedControllers.length === 0) {
    return;
  }

  const controller = state.sharedControllers[state.sharedControllerIndex % state.sharedControllers.length];
  sharedPlayer.ownerId = controller.id;
  sharedPlayer.ownerName = controller.name;
}

function advanceSharedController(state: BlokusState, player: BlokusPlayerState) {
  if (!player.shared || state.sharedControllers.length === 0) {
    return;
  }
  state.sharedControllerIndex = (state.sharedControllerIndex + 1) % state.sharedControllers.length;
  assignSharedController(state);
}

function createColorPlayers(seatedPlayers: Array<{ id: string; name: string }>) {
  const colorAssignments =
    seatedPlayers.length === 2
      ? [0, 1, 0, 1]
      : seatedPlayers.length === 3
        ? [0, 1, 2, null]
        : seatedPlayers.map((_, index) => index);
  const corners = CORNERS_BY_PLAYER_COUNT[colorAssignments.length] ?? CORNERS_BY_PLAYER_COUNT[4];

  return colorAssignments.map((ownerIndex, colorIndex): BlokusPlayerState => {
    const shared = ownerIndex === null;
    const owner = shared ? seatedPlayers[0] : seatedPlayers[ownerIndex];
    return {
      id: `${owner.id}:color-${colorIndex + 1}`,
      ownerId: owner.id,
      ownerName: owner.name,
      scoreOwnerId: shared ? null : owner.id,
      name: shared ? `공용 ${COLOR_NAMES[colorIndex]}` : `${owner.name} ${COLOR_NAMES[colorIndex]}`,
      color: PLAYER_COLORS[colorIndex],
      colorName: COLOR_NAMES[colorIndex],
      shared,
      corner: corners[colorIndex],
      placedPieceIds: []
    };
  });
}

export const module: GameModule = {
  id: "blokus",
  createInitialState: ({ players }) => {
    const seatedPlayers = players
      .filter((player) => player.connected)
      .sort((a, b) => a.seat - b.seat)
      .slice(0, 4);
    const colorPlayers = createColorPlayers(seatedPlayers);

    return {
      board: createBoard(),
      players: colorPlayers,
      sharedControllers: seatedPlayers.length === 3 ? seatedPlayers.map((player) => ({ id: player.id, name: player.name })) : [],
      sharedControllerIndex: 0,
      activeColorId: colorPlayers[0]?.id ?? null,
      phase: "playing",
      message:
        seatedPlayers.length === 3
          ? "첫 블록은 자기 시작 모서리를 덮어야 합니다. 3인 게임의 공용 색은 번갈아 담당하고 점수에서 제외합니다."
          : "첫 블록은 자기 시작 모서리를 덮어야 합니다.",
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
        score: scoreForColor(player),
        canMove: blokusState.phase === "playing" && playerCanMove(blokusState, player)
      })),
      sharedControllers: blokusState.sharedControllers.map((controller) => ({ ...controller })),
      sharedControllerIndex: blokusState.sharedControllerIndex,
      activeColorId: blokusState.activeColorId,
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
      return passBlokusTurn(currentState, context, { requireNoMoves: true, timeout: false });
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
    const actingName = controllerName(player);
    advanceSharedController(nextState, player);

    const turn = getNextTurn(nextState, player.id, context.turnNumber, context.roundNumber);
    if (turn.finished) {
      const winnerIds = finishGame(nextState);
      return {
        state: nextState,
        log: `${actingName} ${pieceDisplayName(piece)} 배치. 블로커스 종료`,
        activePlayerId: null,
        phase: nextState.phase,
        message: nextState.message,
        winnerId: winnerIds.length === 1 ? winnerIds[0] : null
      };
    }

    const nextPlayer = nextState.players.find((item) => item.id === turn.activeColorId);
    nextState.activeColorId = turn.activeColorId ?? null;
    nextState.message = `${actingName}님이 ${pieceDisplayName(piece)}을 놓았습니다. ${nextPlayer ? controllerName(nextPlayer) : "다음 색상"} 차례입니다.`;
    return {
      state: nextState,
      log: `${actingName} ${pieceDisplayName(piece)} 배치`,
      activePlayerId: turn.activePlayerId,
      turnNumber: turn.turnNumber,
      roundNumber: turn.roundNumber,
      phase: nextState.phase,
      message: nextState.message
    };
  },
  applySystemAction: (state, action, context) => {
    const currentState = assertBlokusState(state);
    if (action.type === "system/pass") {
      return passBlokusTurn(currentState, context, { requireNoMoves: true, timeout: false });
    }
    if (action.type === "system/timeout") {
      return passBlokusTurn(currentState, context, { requireNoMoves: false, timeout: true });
    }
    throw new Error("지원하지 않는 블로커스 시스템 행동입니다.");
  }
};

function isBlokusPublicState(state: unknown): state is BlokusPublicState {
  return Boolean(state && typeof state === "object" && Array.isArray((state as BlokusPublicState).board));
}

function PieceMini({ piece, color, cells: displayCells, large = false }: { piece: BlokusPiece; color: string; cells?: Point[]; large?: boolean }) {
  const cells = normalizeCells(displayCells ?? piece.cells);
  const width = Math.max(...cells.map((cell) => cell.x)) + 1;
  const height = Math.max(...cells.map((cell) => cell.y)) + 1;
  const maxSpan = Math.max(width, height);
  const fitCellRem = Math.min(0.68, Math.max(0.42, 2.2 / maxSpan));
  const occupied = new Set(cells.map((cell) => `${cell.x},${cell.y}`));

  return (
    <span
      className="blokus-piece-mini"
      data-large={large ? "true" : undefined}
      style={{
        "--piece-color": color,
        "--piece-width": width,
        "--piece-height": height,
        "--piece-fit-cell": `${fitCellRem}rem`
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
        gap: 0.85rem;
        color: #172033;
        background:
          linear-gradient(135deg, rgba(236, 72, 52, 0.08), transparent 27%),
          linear-gradient(225deg, rgba(34, 140, 93, 0.08), transparent 31%),
          #f8fbff;
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

      .blokus-coach-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 0.75rem;
        align-items: center;
        border: 1px solid color-mix(in srgb, var(--player-color, #64748b) 28%, rgba(15, 23, 42, 0.16));
        border-radius: 8px;
        padding: 0.7rem;
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--player-color, #64748b) 12%, transparent), transparent 46%),
          linear-gradient(180deg, #ffffff, #e8f1fb);
      }

      .blokus-coach-card strong,
      .blokus-coach-card p {
        margin: 0;
      }

      .blokus-coach-card p {
        margin-top: 0.2rem;
        color: #425466;
        font-size: 0.86rem;
        line-height: 1.35;
      }

      .blokus-piece-preview {
        display: grid;
        place-items: center;
        min-width: 68px;
        min-height: 62px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background:
          linear-gradient(90deg, rgba(35, 100, 170, 0.06) 1px, transparent 1px),
          linear-gradient(0deg, rgba(35, 100, 170, 0.06) 1px, transparent 1px),
          #f8fbff;
        background-size: 12px 12px;
      }

      .blokus-state-chips {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 0.35rem;
      }

      .blokus-state-chips span {
        min-height: 26px;
        display: inline-flex;
        align-items: center;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 999px;
        padding: 0 0.55rem;
        color: #172033;
        background: rgba(255, 255, 255, 0.74);
        font-size: 0.78rem;
        font-weight: 800;
        white-space: nowrap;
      }

      .blokus-layout {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.85rem;
        align-items: start;
        min-width: 0;
      }

      .blokus-board {
        display: grid;
        grid-template-columns: repeat(20, minmax(0, 1fr));
        width: min(100%, 620px);
        margin: 0 auto;
        border: 10px solid #c6ccd2;
        background:
          linear-gradient(180deg, #ffffff, #f3f5f7);
        border-radius: 6px;
        overflow: hidden;
        box-shadow:
          inset 0 0 0 2px rgba(255, 255, 255, 0.88),
          inset 0 -8px 0 rgba(25, 34, 45, 0.08),
          0 16px 24px rgba(25, 34, 45, 0.2);
      }

      .blokus-cell {
        position: relative;
        aspect-ratio: 1;
        min-width: 0;
        min-height: 0;
        height: auto;
        border: 0;
        padding: 0;
        border-right: 1px solid #b8c1cc;
        border-bottom: 1px solid #b8c1cc;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.62), transparent 45%),
          var(--cell-color, #f9fbfd);
        cursor: pointer;
      }

      .blokus-cell.occupied {
        box-shadow:
          inset 0 2px 0 rgba(255, 255, 255, 0.48),
          inset 0 -3px 0 rgba(15, 23, 42, 0.16);
      }

      .blokus-cell:disabled {
        cursor: default;
      }

      .blokus-cell.corner::after {
        content: "";
        position: absolute;
        inset: 12%;
        border: 2px solid rgba(25, 34, 45, 0.35);
        border-radius: 3px;
        background: color-mix(in srgb, var(--cell-color, #ffffff) 72%, #ffffff);
        box-shadow: inset 0 -2px 0 rgba(25, 34, 45, 0.12);
      }

      .blokus-cell.anchor {
        box-shadow:
          inset 0 0 0 2px rgba(37, 138, 91, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.42),
          inset 0 -3px 0 rgba(15, 23, 42, 0.08);
      }

      .blokus-cell.anchor:not(.preview)::before {
        content: "";
        position: absolute;
        inset: 34%;
        border-radius: 50%;
        background: rgba(37, 138, 91, 0.72);
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
        grid-template-columns: minmax(160px, 0.72fr) minmax(220px, 1.2fr) minmax(150px, 0.7fr);
        gap: 0.65rem;
        align-items: start;
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
        grid-template-columns: repeat(auto-fit, minmax(6.25rem, 1fr));
        gap: 0.45rem;
      }

      .blokus-placement-hint {
        margin: 0;
        color: #52625d;
        font-size: 0.86rem;
        line-height: 1.4;
      }

      .blokus-controls button,
      .blokus-palette button {
        min-height: 44px;
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
        grid-template-columns: repeat(auto-fit, minmax(54px, 1fr));
        gap: 0.38rem;
      }

      .blokus-palette button {
        display: grid;
        place-items: center;
        gap: 0.2rem;
        padding: 0.35rem 0.2rem;
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

      .blokus-piece-mini[data-large="true"] {
        grid-template-columns: repeat(var(--piece-width), 0.72rem);
        grid-template-rows: repeat(var(--piece-height), 0.72rem);
      }

      .blokus-piece-mini[data-large="true"] span {
        width: 0.72rem;
        height: 0.72rem;
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
        grid-template-columns: 0.85rem minmax(0, 1fr) auto auto;
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
        .blokus-coach-card {
          grid-template-columns: auto minmax(0, 1fr);
        }

        .blokus-state-chips {
          grid-column: 1 / -1;
          justify-content: flex-start;
        }

        .blokus-layout {
          grid-template-columns: 1fr;
          overflow-x: auto;
          padding-bottom: 0.25rem;
        }

        .blokus-board {
          width: min(620px, 94vw);
          max-width: none;
        }

        .blokus-side {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 520px) {
        .blokus-coach-card {
          grid-template-columns: 1fr;
        }

        .blokus-piece-preview {
          justify-self: start;
        }

        .blokus-controls-row {
          grid-template-columns: 1fr;
        }

        .blokus-palette-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `}</style>
  );
}

export function Component({
  publicState,
  currentPlayer,
  disabled,
  onAction
}: GameComponentProps<BlokusPublicState>) {
  const [selectedPieceId, setSelectedPieceId] = useState(PIECES[0].id);
  const [rotation, setRotation] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<Point | null>(null);
  const [keyboardCell, setKeyboardCell] = useState<Point>({ x: 0, y: 0 });
  const [pendingPlacement, setPendingPlacement] = useState<{
    point: Point;
    pieceId: string;
    rotation: number;
    flipped: boolean;
  } | null>(null);
  const [draggingPieceId, setDraggingPieceId] = useState<string | null>(null);
  const orientationHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const orientationHoldFired = useRef(false);
  const [orientationHoldActive, setOrientationHoldActive] = useState(false);
  const state = isBlokusPublicState(publicState) ? publicState : null;
  const activeBlokusPlayer = state?.players.find((player) => player.id === state.activeColorId) ?? null;
  const ownedBlokusPlayers = state?.players.filter((player) => player.ownerId === currentPlayer?.id) ?? [];
  const activeOwnedBlokusPlayer = activeBlokusPlayer?.ownerId === currentPlayer?.id ? activeBlokusPlayer : null;
  const currentBlokusPlayer =
    activeOwnedBlokusPlayer ??
    activeBlokusPlayer ??
    ownedBlokusPlayers.find((player) => player.remainingPieceIds.length > 0) ??
    ownedBlokusPlayers[0] ??
    null;
  const ownedColorLabel = ownedBlokusPlayers.map((player) => player.colorName).join(", ");
  const canInteract =
    !disabled &&
    state?.phase === "playing" &&
    Boolean(activeOwnedBlokusPlayer) &&
    activeBlokusPlayer?.ownerId === currentPlayer?.id;
  const selectedPiece =
    state?.pieceCatalog.find((piece) => piece.id === selectedPieceId && currentBlokusPlayer?.remainingPieceIds.includes(piece.id)) ??
    state?.pieceCatalog.find((piece) => currentBlokusPlayer?.remainingPieceIds.includes(piece.id)) ??
    null;
  const draggingPiece =
    state?.pieceCatalog.find((piece) => piece.id === draggingPieceId && currentBlokusPlayer?.remainingPieceIds.includes(piece.id)) ?? null;
  const placementPiece = draggingPiece ?? selectedPiece;
  const previewPoint = pendingPlacement?.point ?? hoveredCell;
  const preview = useMemo(() => {
    if (!state || !previewPoint || !placementPiece || !currentBlokusPlayer) {
      return { cells: new Set<string>(), valid: false };
    }
    const cells = translateCells(transformCells(placementPiece.cells, rotation, flipped), previewPoint.x, previewPoint.y);
    const valid =
      cells.every(inBounds) &&
      placementCellsAreLegal(state, currentBlokusPlayer, placementPiece.id, cells);
    return {
      cells: new Set(cells.map((cell) => `${cell.x},${cell.y}`)),
      valid
    };
  }, [currentBlokusPlayer, flipped, placementPiece, previewPoint, state, rotation]);
  const legalAnchors = useMemo(() => {
    const anchors = new Set<string>();
    if (!state || !placementPiece || !currentBlokusPlayer || !canInteract) {
      return anchors;
    }
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const cells = translateCells(transformCells(placementPiece.cells, rotation, flipped), x, y);
        if (cells.every(inBounds) && placementCellsAreLegal(state, currentBlokusPlayer, placementPiece.id, cells)) {
          anchors.add(`${x},${y}`);
        }
      }
    }
    return anchors;
  }, [canInteract, currentBlokusPlayer, flipped, placementPiece, rotation, state]);
  const suggestedPlacementPoint = useMemo(() => {
    if (pendingPlacement?.point) {
      return pendingPlacement.point;
    }
    if (hoveredCell) {
      return hoveredCell;
    }
    const firstAnchor = legalAnchors.values().next().value as string | undefined;
    if (!firstAnchor) {
      return null;
    }
    const [x, y] = firstAnchor.split(",").map(Number);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }, [hoveredCell, legalAnchors, pendingPlacement]);
  const precisionCells = useMemo(() => {
    if (!suggestedPlacementPoint) {
      return [];
    }
    const cells: Point[] = [];
    for (let y = suggestedPlacementPoint.y - 2; y <= suggestedPlacementPoint.y + 2; y += 1) {
      for (let x = suggestedPlacementPoint.x - 2; x <= suggestedPlacementPoint.x + 2; x += 1) {
        cells.push({ x, y });
      }
    }
    return cells;
  }, [suggestedPlacementPoint]);
  const placementError = useMemo(() => {
    if (!state || !previewPoint || !placementPiece || !currentBlokusPlayer) {
      return null;
    }
    return getPlacementError(state, currentBlokusPlayer, placementPiece.id, previewPoint.x, previewPoint.y, rotation, flipped);
  }, [currentBlokusPlayer, flipped, placementPiece, previewPoint, rotation, state]);
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [currentBlokusPlayer?.id, currentBlokusPlayer?.remainingPieceIds.length, state?.activeColorId, state?.phase],
    { cooldownMs: 650 }
  );
  const orientedPieceCells = selectedPiece ? transformCells(selectedPiece.cells, rotation, flipped) : [];
  const orientationLabel = `${rotation * 90}도 ${flipped ? "뒤집힘" : "기본면"}`;
  const placementStatusText =
    !canInteract
      ? state?.phase === "playing" && activeBlokusPlayer
        ? `${controllerName(activeBlokusPlayer)} 차례 대기`
        : "게임 종료"
      : previewPoint
        ? placementError ?? "배치 가능"
        : selectedPiece
          ? "보드에서 위치 선택"
          : "블록 선택 필요";
  const placementDockClassName = [
    "blokus-placement-dock",
    !canInteract ? "is-waiting" : "",
    isSubmitting ? "is-submitting" : "",
    pendingPlacement && preview.valid ? "is-ready" : "",
    placementError ? "is-invalid" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    setPendingPlacement(null);
  }, [currentBlokusPlayer?.id, flipped, rotation, selectedPieceId]);

  useEffect(() => {
    if (!canInteract) return;
    const firstAnchor = legalAnchors.values().next().value as string | undefined;
    if (!firstAnchor) return;
    const [x, y] = firstAnchor.split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      setKeyboardCell({ x, y });
    }
  }, [canInteract, currentBlokusPlayer?.id, flipped, legalAnchors, rotation, selectedPieceId]);

  useEffect(() => {
    if (!canInteract) {
      setDraggingPieceId(null);
      setPendingPlacement(null);
      clearOrientationHold();
    }
  }, [canInteract]);

  useEffect(() => {
    return () => {
      if (orientationHoldTimer.current) {
        clearTimeout(orientationHoldTimer.current);
      }
    };
  }, []);

  if (!state) {
    return (
      <div className="blokus-module">
        <BlokusStyles />
        <div className="blokus-empty">블로커스 상태를 불러오는 중입니다.</div>
      </div>
    );
  }

  function commitPieceAt(point: Point, piece: BlokusPiece) {
    if (!canInteract || !currentBlokusPlayer || isSubmitting) {
      return;
    }
    const error = currentBlokusPlayer
      ? getPlacementError(state, currentBlokusPlayer, piece.id, point.x, point.y, rotation, flipped)
      : "블로커스 플레이어를 찾을 수 없습니다.";
    if (error) {
      setPendingPlacement(null);
      setHoveredCell(point);
      return;
    }
    setPendingPlacement(null);
    submitAction({
      type: "place-piece",
      payload: {
        pieceId: piece.id,
        x: point.x,
        y: point.y,
        rotation,
        flipped
      }
    });
  }

  function placeAt(point: Point) {
    if (!canInteract || !selectedPiece) {
      return;
    }
    const error = currentBlokusPlayer
      ? getPlacementError(state, currentBlokusPlayer, selectedPiece.id, point.x, point.y, rotation, flipped)
      : "블로커스 플레이어를 찾을 수 없습니다.";
    if (error) {
      setPendingPlacement(null);
      setHoveredCell(point);
      return;
    }
    const confirmed =
      pendingPlacement?.point.x === point.x &&
      pendingPlacement.point.y === point.y &&
      pendingPlacement.pieceId === selectedPiece.id &&
      pendingPlacement.rotation === rotation &&
      pendingPlacement.flipped === flipped;
    if (!confirmed) {
      setPendingPlacement({ point, pieceId: selectedPiece.id, rotation, flipped });
      setHoveredCell(point);
      return;
    }
    commitPieceAt(point, selectedPiece);
  }

  function focusBoardCell(point: Point) {
    const next = {
      x: Math.max(0, Math.min(BOARD_SIZE - 1, point.x)),
      y: Math.max(0, Math.min(BOARD_SIZE - 1, point.y))
    };
    setKeyboardCell(next);
    setHoveredCell(next);
    window.requestAnimationFrame(() => {
      boardRef.current
        ?.querySelector<HTMLButtonElement>(`[data-blokus-x="${next.x}"][data-blokus-y="${next.y}"]`)
        ?.focus();
    });
  }

  function handleBoardCellKeyDown(event: KeyboardEvent<HTMLButtonElement>, point: Point) {
    const movement: Record<string, Point> = {
      ArrowUp: { x: point.x, y: point.y - 1 },
      ArrowDown: { x: point.x, y: point.y + 1 },
      ArrowLeft: { x: point.x - 1, y: point.y },
      ArrowRight: { x: point.x + 1, y: point.y },
      Home: { x: 0, y: point.y },
      End: { x: BOARD_SIZE - 1, y: point.y }
    };
    const next = movement[event.key];
    if (!next) return;
    event.preventDefault();
    focusBoardCell(next);
  }

  function confirmPlacement() {
    if (!pendingPlacement) return;
    placeAt(pendingPlacement.point);
  }

  function rotateSelectedPiece() {
    if (!canInteract) {
      return;
    }
    setPendingPlacement(null);
    setRotation((value) => (value + 1) % 4);
  }

  function flipSelectedPiece() {
    if (!canInteract) {
      return;
    }
    setPendingPlacement(null);
    setFlipped((value) => !value);
  }

  function clearOrientationHold() {
    if (orientationHoldTimer.current) {
      clearTimeout(orientationHoldTimer.current);
      orientationHoldTimer.current = null;
    }
    setOrientationHoldActive(false);
  }

  function startOrientationHold(event: PointerEvent<HTMLButtonElement>) {
    if (!canInteract) {
      return;
    }
    orientationHoldFired.current = false;
    clearOrientationHold();
    setOrientationHoldActive(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser has already canceled the pointer.
    }
    orientationHoldTimer.current = setTimeout(() => {
      orientationHoldFired.current = true;
      flipSelectedPiece();
      orientationHoldTimer.current = null;
      setOrientationHoldActive(false);
    }, 460);
  }

  function clickOrientationPiece() {
    if (!canInteract) {
      return;
    }
    if (orientationHoldFired.current) {
      orientationHoldFired.current = false;
      return;
    }
    rotateSelectedPiece();
  }

  function handleOrientationKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key.toLowerCase() !== "f") {
      return;
    }
    event.preventDefault();
    flipSelectedPiece();
  }

  function startPieceDrag(event: DragEvent<HTMLElement>, piece: BlokusPiece) {
    if (!canInteract) {
      event.preventDefault();
      return;
    }
    setSelectedPieceId(piece.id);
    setDraggingPieceId(piece.id);
    setPendingPlacement(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", piece.id);
  }

  function handleCellDragOver(event: DragEvent<HTMLButtonElement>, point: Point) {
    if (!state || !currentBlokusPlayer || !canInteract || !placementPiece) {
      return;
    }
    event.preventDefault();
    setHoveredCell(point);
    const cells = translateCells(transformCells(placementPiece.cells, rotation, flipped), point.x, point.y);
    event.dataTransfer.dropEffect =
      cells.every(inBounds) && placementCellsAreLegal(state, currentBlokusPlayer!, placementPiece.id, cells) ? "move" : "none";
  }

  function handleCellDrop(event: DragEvent<HTMLButtonElement>, point: Point) {
    if (!state) {
      return;
    }
    event.preventDefault();
    const pieceId = event.dataTransfer.getData("text/plain") || draggingPieceId || selectedPiece?.id;
    const piece =
      state.pieceCatalog.find((candidate) => candidate.id === pieceId && currentBlokusPlayer?.remainingPieceIds.includes(candidate.id)) ??
      selectedPiece;
    setDraggingPieceId(null);
    setHoveredCell(point);
    if (!piece) {
      return;
    }
    setSelectedPieceId(piece.id);
    commitPieceAt(point, piece);
  }

  return (
    <div className={`blokus-module ${draggingPieceId ? "is-dragging-piece" : ""}`}>
      <BlokusStyles />
      <div className="blokus-status">
        <div>
          <strong>{state.phase === "finished" ? "게임 종료" : `${activeBlokusPlayer ? controllerName(activeBlokusPlayer) : "대기"} 차례`}</strong>
        </div>
        {activeBlokusPlayer ? (
          <span style={{ color: activeBlokusPlayer.color }}>
            {activeOwnedBlokusPlayer ? ownedColorLabel : activeBlokusPlayer.colorName}
          </span>
        ) : null}
      </div>

      <div className="blokus-coach-card" style={{ "--player-color": currentBlokusPlayer?.color ?? "#64748b" } as CSSProperties}>
        <div className="blokus-piece-preview">
          {selectedPiece ? (
            <span
              className="blokus-drag-handle"
              draggable={canInteract}
              onDragEnd={() => setDraggingPieceId(null)}
              onDragStart={(event) => startPieceDrag(event, selectedPiece)}
            >
              <PieceMini piece={selectedPiece} color={currentBlokusPlayer?.color ?? "#64748b"} cells={orientedPieceCells} large />
            </span>
          ) : null}
        </div>
        <div>
          <strong>{selectedPiece ? `${selectedPiece.name} 블록` : "블록 선택 필요"}</strong>
        </div>
        <div className="blokus-state-chips" aria-label="블록 상태">
          <span>{orientationLabel}</span>
          <span>{pendingPlacement ? "위치 고정됨" : "미리보기 대기"}</span>
          <span>{currentBlokusPlayer ? `${currentBlokusPlayer.remainingPieceIds.length}개 남음` : "대기"}</span>
        </div>
      </div>

      <div className="blokus-layout">
        <div
          ref={boardRef}
          className="blokus-board"
          role="group"
          aria-label="블로커스 20x20 보드"
          onMouseLeave={() => setHoveredCell(null)}
        >
          {state.board.flatMap((row, y) =>
            row.map((ownerId, x) => {
              const owner = state.players.find((player) => player.id === ownerId);
              const cornerOwner = state.players.find((player) => player.corner.x === x && player.corner.y === y);
              const key = `${x},${y}`;
              const isPreview = preview.cells.has(key);
              const isAnchor = legalAnchors.has(key);
              return (
                <button
                  key={key}
                  className={[
                    "blokus-cell",
                    owner ? "occupied" : "",
                    cornerOwner ? "corner" : "",
                    isAnchor ? "anchor" : "",
                    isPreview ? "preview" : "",
                    isPreview && !preview.valid ? "invalid" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  disabled={!canInteract}
                  tabIndex={canInteract && keyboardCell.x === x && keyboardCell.y === y ? 0 : -1}
                  data-blokus-x={x}
                  data-blokus-y={y}
                  onClick={() => placeAt({ x, y })}
                  onDragEnter={(event) => handleCellDragOver(event, { x, y })}
                  onDragOver={(event) => handleCellDragOver(event, { x, y })}
                  onDrop={(event) => handleCellDrop(event, { x, y })}
                  onFocus={() => {
                    setKeyboardCell({ x, y });
                    setHoveredCell({ x, y });
                  }}
                  onKeyDown={(event) => handleBoardCellKeyDown(event, { x, y })}
                  onMouseEnter={() => setHoveredCell({ x, y })}
                  style={{
                    "--cell-color": owner?.color ?? "#f8fafc",
                    "--preview-color": currentBlokusPlayer?.color ?? "#94a3b8"
                  } as CSSProperties}
                  title={`${x + 1}, ${y + 1}${cornerOwner ? ` · ${cornerOwner.name} 시작 모서리` : ""}${isAnchor ? " · 놓을 수 있음" : ""}`}
                  aria-label={`${x + 1}열 ${y + 1}행${owner ? ` ${owner.colorName} 블록` : ""}${isAnchor ? " 배치 가능" : ""}`}
                />
              );
            })
          )}
        </div>

        <section
          className={placementDockClassName}
          aria-label="블로커스 확대 배치 도우미"
          aria-describedby="blokus-placement-feedback"
          aria-live="polite"
        >
          <div className="blokus-placement-head">
            <div>
              <span>{pendingPlacement ? "확정 대기" : "확대 배치"}</span>
              <strong>{selectedPiece ? `${selectedPiece.name} 블록 · ${orientationLabel}` : "블록 선택 필요"}</strong>
            </div>
            <small>
              {!canInteract
                ? "대기"
                : previewPoint
                ? `${previewPoint.x + 1}열 ${previewPoint.y + 1}행`
                : legalAnchors.size > 0
                  ? "위치 선택"
                  : "놓을 수 있는 위치 없음"}
            </small>
          </div>

          <div className="blokus-placement-body">
            <div className="blokus-precision-board" aria-label="선택 위치 주변 5x5 확대 보드">
              {precisionCells.length > 0 ? (
                precisionCells.map((point) => {
                  const pointInBounds = inBounds(point);
                  const ownerId = pointInBounds ? state.board[point.y][point.x] : null;
                  const owner = state.players.find((player) => player.id === ownerId);
                  const cornerOwner = pointInBounds
                    ? state.players.find((player) => player.corner.x === point.x && player.corner.y === point.y)
                    : null;
                  const pointKey = `${point.x},${point.y}`;
                  const isPreview = preview.cells.has(pointKey);
                  const isAnchor = legalAnchors.has(pointKey);
                  const isCenter = suggestedPlacementPoint?.x === point.x && suggestedPlacementPoint.y === point.y;
                  return (
                    <button
                      key={`precision-${pointKey}`}
                      className={[
                        "blokus-precision-cell",
                        owner ? "occupied" : "",
                        cornerOwner ? "corner" : "",
                        isAnchor ? "anchor" : "",
                        isPreview ? "preview" : "",
                        isPreview && !preview.valid ? "invalid" : "",
                        isCenter ? "center" : "",
                        !pointInBounds ? "out" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      disabled={!canInteract || !pointInBounds}
                      onClick={() => placeAt(point)}
                      onFocus={() => setHoveredCell(point)}
                      onMouseEnter={() => setHoveredCell(point)}
                      style={{
                        "--cell-color": owner?.color ?? "#f8fafc",
                        "--preview-color": currentBlokusPlayer?.color ?? "#94a3b8"
                      } as CSSProperties}
                      aria-label={`${point.x + 1}열 ${point.y + 1}행${owner ? ` ${owner.colorName} 블록` : ""}${isAnchor ? " 배치 가능" : ""}`}
                    />
                  );
                })
              ) : (
                <div className="blokus-precision-empty">
                  {!canInteract ? "상대 차례 대기" : selectedPiece ? "놓을 수 있는 위치 없음" : "배치할 블록을 선택하세요."}
                </div>
              )}
            </div>

            <div className="blokus-placement-tools">
              <div className="blokus-piece-preview blokus-piece-preview-precision">
                {selectedPiece ? (
                  <button
                    className={`blokus-orient-pad ${orientationHoldActive ? "is-holding" : ""}`}
                    type="button"
                    disabled={!canInteract}
                    onClick={clickOrientationPiece}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      flipSelectedPiece();
                    }}
                    onKeyDown={handleOrientationKeyDown}
                    onPointerCancel={clearOrientationHold}
                    onPointerDown={startOrientationHold}
                    onPointerLeave={clearOrientationHold}
                    onPointerUp={clearOrientationHold}
                    aria-label={`${selectedPiece.name} 블록 방향 조절. 누르면 회전, 길게 누르면 뒤집기`}
                    title="누르면 회전 · 길게 누르면 뒤집기"
                  >
                    <PieceMini piece={selectedPiece} color={currentBlokusPlayer?.color ?? "#64748b"} cells={orientedPieceCells} large />
                    <span className="blokus-orient-badges" aria-hidden="true">
                      <span><RotateCw size={12} /></span>
                      <span><FlipHorizontal size={12} /></span>
                    </span>
                  </button>
                ) : null}
              </div>
              <div className="blokus-controls-row blokus-controls-row-precision">
                <button
                  className="blokus-placement-confirm"
                  type="button"
                  onClick={confirmPlacement}
                  disabled={!canInteract || isSubmitting || !pendingPlacement || !preview.valid}
                >
                  {!canInteract ? "대기" : pendingPlacement ? "확정" : "위치 선택"}
                </button>
                <button
                  className="blokus-placement-secondary"
                  type="button"
                  onClick={() => setPendingPlacement(null)}
                  disabled={!pendingPlacement}
                >
                  취소
                </button>
                {currentBlokusPlayer?.canMove === false ? (
                  <button
                    className="blokus-placement-secondary"
                    type="button"
                    onClick={() => {
                      submitAction({ type: "pass" });
                    }}
                    disabled={!canInteract || isSubmitting}
                  >
                    <SkipForward size={16} />
                    패스
                  </button>
                ) : null}
              </div>
              <p
                id="blokus-placement-feedback"
                className={`blokus-placement-feedback ${placementError ? "invalid" : previewPoint ? "valid" : ""}`}
              >
                {placementStatusText}
              </p>
            </div>
          </div>
        </section>

        <aside className="blokus-side" aria-label="블로커스 블록 선택">
          <section className="blokus-palette" style={{ "--player-color": currentBlokusPlayer?.color ?? "#64748b" } as CSSProperties}>
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
                    draggable={available && canInteract}
                    onDragEnd={() => setDraggingPieceId(null)}
                    onDragStart={(event) => startPieceDrag(event, piece)}
                    aria-label={pieceDisplayName(piece)}
                    title={pieceDisplayName(piece)}
                  >
                    <PieceMini piece={piece} color={currentBlokusPlayer?.color ?? "#64748b"} />
                  </button>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
