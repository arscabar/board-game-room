import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const CAT_MARKERS_BY_PLAYER = [
  {
    large: "/board-assets/game-markers/kkukkkuki-cat-adult.png",
    small: "/board-assets/game-markers/kkukkkuki-kitten.png"
  },
  {
    large: "/board-assets/game-markers/kkukkkuki-cat-adult-player2.png",
    small: "/board-assets/game-markers/kkukkkuki-kitten-player2.png"
  }
] as const;
const BOARD_SIZE = 6;
const STARTING_SMALL = 8;
const LINE_LENGTH = 3;

const directions = [
  { row: -1, col: -1 },
  { row: -1, col: 0 },
  { row: -1, col: 1 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 }
] as const;

const lineDirections = [
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: -1 }
] as const;

type PieceSize = "small" | "large";
type Phase = "playing" | "choose-line" | "choose-piece" | "complete";

interface Coord {
  row: number;
  col: number;
}

interface KkukkkukiPlayer {
  id: string;
  name: string;
  seat: number;
  color: string;
}

interface KkukkkukiPiece {
  id: string;
  ownerId: string;
  size: PieceSize;
}

interface KkukkkukiReserve {
  small: number;
  large: number;
}

interface PendingLine {
  key: string;
  coords: Coord[];
  allLarge: boolean;
}

interface BoopTrace {
  pieceId: string;
  ownerId: string;
  size: PieceSize;
  from: Coord;
  to: Coord | null;
}

interface KkukkkukiState {
  boardSize: number;
  players: KkukkkukiPlayer[];
  board: Array<Array<KkukkkukiPiece | null>>;
  reserves: Record<string, KkukkkukiReserve>;
  phase: Phase;
  activePlayerId: string | null;
  winnerId: string | null;
  winnerIds: string[];
  message: string;
  pendingLines: PendingLine[];
  pendingPlayerId: string | null;
  lastPlaced: (Coord & { pieceId: string }) | null;
  boopTrace: BoopTrace[];
  actionNonce: number;
}

interface PlacePayload {
  row: number;
  col: number;
  size: PieceSize;
}

interface ChooseLinePayload {
  lineKey: string;
}

interface RemovePayload {
  row: number;
  col: number;
}

const playerColors = ["#c46d43", "#6e88d7"];

function assertKkukkkukiState(state: unknown): KkukkkukiState {
  if (!state || typeof state !== "object") {
    throw new Error("꾹꾹이 상태가 올바르지 않습니다.");
  }
  return state as KkukkkukiState;
}

function isCoord(value: unknown): value is Coord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.row) && Number.isInteger(item.col);
}

function isPlacePayload(value: unknown): value is PlacePayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isCoord(item) && (item.size === "small" || item.size === "large");
}

function isChooseLinePayload(value: unknown): value is ChooseLinePayload {
  return Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>).lineKey === "string");
}

function isRemovePayload(value: unknown): value is RemovePayload {
  return isCoord(value);
}

function inBoard(row: number, col: number) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function coordKey(coord: Coord) {
  return `${coord.row},${coord.col}`;
}

function lineKey(coords: Coord[]) {
  return coords.map(coordKey).join("|");
}

function cloneBoard(board: KkukkkukiState["board"]) {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

function cloneState(state: KkukkkukiState): KkukkkukiState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    board: cloneBoard(state.board),
    reserves: Object.fromEntries(Object.entries(state.reserves).map(([playerId, reserve]) => [playerId, { ...reserve }])),
    pendingLines: state.pendingLines.map((line) => ({
      ...line,
      coords: line.coords.map((coord) => ({ ...coord }))
    })),
    lastPlaced: state.lastPlaced ? { ...state.lastPlaced } : null,
    boopTrace: state.boopTrace.map((trace) => ({
      ...trace,
      from: { ...trace.from },
      to: trace.to ? { ...trace.to } : null
    })),
    winnerIds: [...state.winnerIds]
  };
}

function playerName(state: KkukkkukiState, playerId: string | null | undefined) {
  return state.players.find((player) => player.id === playerId)?.name ?? "플레이어";
}

function markerFor(piece: KkukkkukiPiece, owner?: KkukkkukiPlayer) {
  const markerSet = CAT_MARKERS_BY_PLAYER[((owner?.seat ?? 1) - 1) % CAT_MARKERS_BY_PLAYER.length] ?? CAT_MARKERS_BY_PLAYER[0];
  return markerSet[piece.size];
}

function boopTilt(rowDelta: number, colDelta: number, multiplier = 1) {
  let tilt = 0;
  if (colDelta < 0) tilt = 9;
  else if (colDelta > 0) tilt = -9;
  else if (rowDelta < 0) tilt = -5;
  else if (rowDelta > 0) tilt = 5;
  return `${tilt * multiplier}deg`;
}

function reserveFor(state: KkukkkukiState, playerId: string) {
  const reserve = state.reserves[playerId];
  if (!reserve) {
    throw new Error("플레이어 보유 말을 찾을 수 없습니다.");
  }
  return reserve;
}

function connectedOrder(state: KkukkkukiState, context: GameContext) {
  const connectedIds = new Set(context.players.filter((player) => player.connected).map((player) => player.id));
  return state.players.filter((player) => connectedIds.has(player.id));
}

function nextTurn(state: KkukkkukiState, context: GameContext) {
  const order = connectedOrder(state, context);
  if (order.length === 0) {
    return { activePlayerId: null, turnNumber: context.turnNumber + 1, roundNumber: context.roundNumber };
  }
  const currentIndex = order.findIndex((player) => player.id === context.currentPlayerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
  return {
    activePlayerId: order[nextIndex].id,
    turnNumber: context.turnNumber + 1,
    roundNumber: context.roundNumber + (currentIndex !== -1 && nextIndex === 0 ? 1 : 0)
  };
}

function requireActivePlayer(state: KkukkkukiState, context: GameContext) {
  if (state.phase === "complete" || state.winnerId) {
    throw new Error("이미 끝난 꾹꾹이입니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId || state.activePlayerId !== context.currentPlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("꾹꾹이 플레이어를 찾을 수 없습니다.");
  }
  return player;
}

function pieceCountOnBoard(state: KkukkkukiState, ownerId: string) {
  let count = 0;
  for (const row of state.board) {
    for (const piece of row) {
      if (piece?.ownerId === ownerId) {
        count += 1;
      }
    }
  }
  return count;
}

function allPiecesOnBoardAreLarge(state: KkukkkukiState, ownerId: string) {
  let count = 0;
  for (const row of state.board) {
    for (const piece of row) {
      if (piece?.ownerId !== ownerId) {
        continue;
      }
      count += 1;
      if (piece.size !== "large") {
        return false;
      }
    }
  }
  return count === STARTING_SMALL;
}

function collectLines(state: KkukkkukiState, ownerId: string) {
  const lines: PendingLine[] = [];
  const seen = new Set<string>();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      for (const direction of lineDirections) {
        const coords = Array.from({ length: LINE_LENGTH }, (_, index) => ({
          row: row + direction.row * index,
          col: col + direction.col * index
        }));
        if (!coords.every((coord) => inBoard(coord.row, coord.col))) {
          continue;
        }
        const pieces = coords.map((coord) => state.board[coord.row][coord.col]);
        if (!pieces.every((piece) => piece?.ownerId === ownerId)) {
          continue;
        }
        const key = lineKey(coords);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        lines.push({
          key,
          coords,
          allLarge: pieces.every((piece) => piece?.size === "large")
        });
      }
    }
  }
  return lines;
}

function canBoop(placed: KkukkkukiPiece, target: KkukkkukiPiece) {
  return placed.size === "large" || target.size === "small";
}

function createPiece(ownerId: string, size: PieceSize, nonce: number) {
  return {
    id: `${ownerId}-${size}-${nonce}`,
    ownerId,
    size
  } satisfies KkukkkukiPiece;
}

function applyBoops(state: KkukkkukiState, placedCoord: Coord, placedPiece: KkukkkukiPiece) {
  const trace: BoopTrace[] = [];
  for (const direction of directions) {
    const targetCoord = { row: placedCoord.row + direction.row, col: placedCoord.col + direction.col };
    if (!inBoard(targetCoord.row, targetCoord.col)) {
      continue;
    }
    const targetPiece = state.board[targetCoord.row][targetCoord.col];
    if (!targetPiece || !canBoop(placedPiece, targetPiece)) {
      continue;
    }
    const destination = { row: targetCoord.row + direction.row, col: targetCoord.col + direction.col };
    if (!inBoard(destination.row, destination.col)) {
      state.board[targetCoord.row][targetCoord.col] = null;
      reserveFor(state, targetPiece.ownerId)[targetPiece.size] += 1;
      trace.push({ pieceId: targetPiece.id, ownerId: targetPiece.ownerId, size: targetPiece.size, from: targetCoord, to: null });
      continue;
    }
    if (state.board[destination.row][destination.col]) {
      continue;
    }
    state.board[destination.row][destination.col] = targetPiece;
    state.board[targetCoord.row][targetCoord.col] = null;
    trace.push({ pieceId: targetPiece.id, ownerId: targetPiece.ownerId, size: targetPiece.size, from: targetCoord, to: destination });
  }
  return trace;
}

function graduateLine(state: KkukkkukiState, playerId: string, coords: Coord[]) {
  const reserve = reserveFor(state, playerId);
  for (const coord of coords) {
    const piece = state.board[coord.row][coord.col];
    if (!piece || piece.ownerId !== playerId) {
      throw new Error("선택한 줄이 더 이상 유효하지 않습니다.");
    }
    state.board[coord.row][coord.col] = null;
    reserve.large += 1;
  }
}

function finishForWinner(state: KkukkkukiState, winnerId: string, message: string, context: GameContext, log: string): GameActionResult {
  state.phase = "complete";
  state.activePlayerId = null;
  state.winnerId = winnerId;
  state.winnerIds = [winnerId];
  state.pendingLines = [];
  state.pendingPlayerId = null;
  state.message = message;
  return {
    state,
    log,
    activePlayerId: null,
    turnNumber: context.turnNumber + 1,
    phase: "complete",
    message,
    winnerId,
    winnerIds: [winnerId]
  };
}

function finishTurn(state: KkukkkukiState, context: GameContext, log: string): GameActionResult {
  const turn = nextTurn(state, context);
  state.phase = "playing";
  state.activePlayerId = turn.activePlayerId;
  state.pendingLines = [];
  state.pendingPlayerId = null;
  state.message = `${playerName(state, turn.activePlayerId)}님 차례입니다.`;
  return {
    state,
    log,
    activePlayerId: turn.activePlayerId,
    turnNumber: turn.turnNumber,
    roundNumber: turn.roundNumber,
    phase: "playing",
    message: state.message
  };
}

function resolveAfterPlacement(state: KkukkkukiState, playerId: string, context: GameContext, log: string): GameActionResult {
  if (allPiecesOnBoardAreLarge(state, playerId)) {
    return finishForWinner(state, playerId, `${playerName(state, playerId)}님이 큰 말 8개를 모두 보드에 올렸습니다.`, context, log);
  }

  const lines = collectLines(state, playerId);
  const winningLine = lines.find((line) => line.allLarge);
  if (winningLine) {
    return finishForWinner(state, playerId, `${playerName(state, playerId)}님이 큰 말 3개를 이었습니다.`, context, log);
  }

  if (lines.length === 1) {
    graduateLine(state, playerId, lines[0].coords);
    state.message = `${playerName(state, playerId)}님이 작은 말을 큰 말로 승급했습니다.`;
    return finishTurn(state, context, log);
  }

  if (lines.length > 1) {
    state.phase = "choose-line";
    state.pendingLines = lines;
    state.pendingPlayerId = playerId;
    state.message = "승급할 3개 줄 하나를 선택하세요.";
    return {
      state,
      log,
      activePlayerId: playerId,
      phase: "choose-line",
      message: state.message
    };
  }

  if (pieceCountOnBoard(state, playerId) >= STARTING_SMALL) {
    state.phase = "choose-piece";
    state.pendingPlayerId = playerId;
    state.message = "내 말 8개가 모두 보드 위에 있습니다. 큰 말로 바꿀 말 하나를 회수하세요.";
    return {
      state,
      log,
      activePlayerId: playerId,
      phase: "choose-piece",
      message: state.message
    };
  }

  return finishTurn(state, context, log);
}

function placePiece(state: KkukkkukiState, action: GameAction, context: GameContext): GameActionResult {
  if (!isPlacePayload(action.payload)) {
    throw new Error("놓을 위치와 말 크기가 필요합니다.");
  }
  const player = requireActivePlayer(state, context);
  if (state.phase !== "playing") {
    throw new Error("현재 선택 단계를 먼저 처리해야 합니다.");
  }
  const { row, col, size } = action.payload;
  if (!inBoard(row, col)) {
    throw new Error("보드 밖에는 말을 놓을 수 없습니다.");
  }
  if (state.board[row][col]) {
    throw new Error("이미 말이 있는 칸입니다.");
  }
  const reserve = reserveFor(state, player.id);
  if (reserve[size] <= 0) {
    throw new Error(size === "small" ? "남은 작은 말이 없습니다." : "남은 큰 말이 없습니다.");
  }

  const next = cloneState(state);
  const nextReserve = reserveFor(next, player.id);
  nextReserve[size] -= 1;
  next.actionNonce += 1;
  const piece = createPiece(player.id, size, next.actionNonce);
  next.board[row][col] = piece;
  next.lastPlaced = { row, col, pieceId: piece.id };
  next.boopTrace = applyBoops(next, { row, col }, piece);

  return resolveAfterPlacement(next, player.id, context, `${player.name} ${size === "small" ? "작은 말" : "큰 말"} 배치`);
}

function chooseLine(state: KkukkkukiState, action: GameAction, context: GameContext): GameActionResult {
  if (!isChooseLinePayload(action.payload)) {
    throw new Error("승급할 줄을 선택해주세요.");
  }
  const payload = action.payload;
  const player = requireActivePlayer(state, context);
  if (state.phase !== "choose-line" || state.pendingPlayerId !== player.id) {
    throw new Error("지금은 승급 줄을 선택할 단계가 아닙니다.");
  }
  const selected = state.pendingLines.find((line) => line.key === payload.lineKey);
  if (!selected) {
    throw new Error("선택한 줄을 찾을 수 없습니다.");
  }
  const next = cloneState(state);
  graduateLine(next, player.id, selected.coords);
  next.message = `${player.name}님이 말 3개를 큰 말로 바꿨습니다.`;
  return finishTurn(next, context, `${player.name} 승급 줄 선택`);
}

function removePiece(state: KkukkkukiState, action: GameAction, context: GameContext): GameActionResult {
  if (!isRemovePayload(action.payload)) {
    throw new Error("회수할 말을 선택해주세요.");
  }
  const player = requireActivePlayer(state, context);
  if (state.phase !== "choose-piece" || state.pendingPlayerId !== player.id) {
    throw new Error("지금은 회수할 말을 선택할 단계가 아닙니다.");
  }
  const { row, col } = action.payload;
  if (!inBoard(row, col)) {
    throw new Error("보드 밖의 말은 회수할 수 없습니다.");
  }
  const piece = state.board[row][col];
  if (!piece || piece.ownerId !== player.id) {
    throw new Error("내 말만 회수할 수 있습니다.");
  }
  const next = cloneState(state);
  next.board[row][col] = null;
  reserveFor(next, player.id).large += 1;
  next.message = `${player.name}님이 큰 말 하나를 보유함에 추가했습니다.`;
  return finishTurn(next, context, `${player.name} 말 회수`);
}

function createInitialState({ players }: Pick<GameContext, "players">): KkukkkukiState {
  const seatedPlayers = players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 2);
  const modulePlayers = seatedPlayers.map((player, index): KkukkkukiPlayer => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    color: playerColors[index] ?? "#c46d43"
  }));
  const reserves = Object.fromEntries(
    modulePlayers.map((player) => [player.id, { small: STARTING_SMALL, large: 0 } satisfies KkukkkukiReserve])
  );
  const firstPlayer = modulePlayers[0] ?? null;

  return {
    boardSize: BOARD_SIZE,
    players: modulePlayers,
    board: Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null)),
    reserves,
    phase: "playing",
    activePlayerId: firstPlayer?.id ?? null,
    winnerId: null,
    winnerIds: [],
    message: firstPlayer ? `${firstPlayer.name}님부터 방석에 말을 놓습니다.` : "2명이 모이면 시작할 수 있습니다.",
    pendingLines: [],
    pendingPlayerId: null,
    lastPlaced: null,
    boopTrace: [],
    actionNonce: 0
  };
}

export const module: GameModule = {
  id: "kkukkkuki",
  createInitialState,
  getPublicState: (state) => assertKkukkkukiState(state),
  applyAction: (state, action, context) => {
    const currentState = assertKkukkkukiState(state);
    if (action.type === "kkukkkuki/place-piece") {
      return placePiece(currentState, action, context);
    }
    if (action.type === "kkukkkuki/choose-line") {
      return chooseLine(currentState, action, context);
    }
    if (action.type === "kkukkkuki/remove-piece") {
      return removePiece(currentState, action, context);
    }
    throw new Error("지원하지 않는 꾹꾹이 행동입니다.");
  }
};

export function Component({
  players,
  currentPlayer,
  activePlayer,
  publicState,
  disabled,
  onAction
}: GameComponentProps<KkukkkukiState>) {
  const state = assertKkukkkukiState(publicState);
  const [selectedSize, setSelectedSize] = useState<PieceSize>("small");
  const activeReserve = currentPlayer ? state.reserves[currentPlayer.id] : null;
  const myTurn = currentPlayer?.id === state.activePlayerId;
  const canAct = !disabled && myTurn && state.phase !== "complete";
  const pendingCoordKeys = useMemo(() => new Set(state.pendingLines.flatMap((line) => line.coords.map(coordKey))), [state.pendingLines]);
  const boopByPieceId = useMemo(() => new Map(state.boopTrace.map((trace) => [trace.pieceId, trace])), [state.boopTrace]);

  useEffect(() => {
    if (selectedSize === "small" && activeReserve?.small === 0 && activeReserve.large > 0) {
      setSelectedSize("large");
    }
    if (selectedSize === "large" && activeReserve?.large === 0 && activeReserve.small > 0) {
      setSelectedSize("small");
    }
  }, [activeReserve?.large, activeReserve?.small, selectedSize]);

  function handleCell(row: number, col: number) {
    if (!canAct) return;
    if (state.phase === "choose-piece") {
      onAction({ type: "kkukkkuki/remove-piece", payload: { row, col } });
      return;
    }
    if (state.phase !== "playing") return;
    onAction({ type: "kkukkkuki/place-piece", payload: { row, col, size: selectedSize } });
  }

  function boopOffset(delta: number) {
    if (delta < 0) return "calc(0px - var(--kkuk-step))";
    if (delta > 0) return "var(--kkuk-step)";
    return "0px";
  }

  return (
    <div className="game-module kkuk-shell">
      <section className="kkuk-status" aria-label="꾹꾹이 진행 상태">
        <div>
          <strong>차례</strong>
          <span>{activePlayer?.name ?? "종료"}</span>
        </div>
        <p>{state.message}</p>
        <div>
          <strong>단계</strong>
          <span>{phaseLabel(state.phase)}</span>
        </div>
      </section>

      <section className="kkuk-layout">
        <div className="kkuk-board-wrap">
          <div className="kkuk-board" style={{ "--kkuk-size": BOARD_SIZE } as CSSProperties} aria-label="꾹꾹이 6 x 6 방석판">
            {state.board.map((row, rowIndex) =>
              row.map((piece, colIndex) => {
                const owner = state.players.find((player) => player.id === piece?.ownerId);
                const boop = piece ? boopByPieceId.get(piece.id) : null;
                const isLast = state.lastPlaced?.row === rowIndex && state.lastPlaced.col === colIndex;
                const pending = pendingCoordKeys.has(coordKey({ row: rowIndex, col: colIndex }));
                const removable = state.phase === "choose-piece" && piece?.ownerId === currentPlayer?.id;
                const pieceStyle = {
                  "--piece-color": owner?.color ?? "#c46d43",
                  "--boop-start-x": boop?.to ? boopOffset(boop.from.col - colIndex) : "0px",
                  "--boop-start-y": boop?.to ? boopOffset(boop.from.row - rowIndex) : "0px",
                  "--boop-tilt": boop?.to ? boopTilt(boop.from.row - rowIndex, boop.from.col - colIndex) : "0deg",
                  "--boop-counter-tilt": boop?.to ? boopTilt(boop.from.row - rowIndex, boop.from.col - colIndex, -0.55) : "0deg",
                  "--boop-settle-tilt": boop?.to ? boopTilt(boop.from.row - rowIndex, boop.from.col - colIndex, 0.34) : "0deg"
                } as CSSProperties;
                return (
                  <button
                    key={`${rowIndex}-${colIndex}`}
                    className={`kkuk-cell ${piece ? "occupied" : ""} ${isLast ? "last" : ""} ${pending ? "pending-line" : ""} ${removable ? "removable" : ""}`}
                    type="button"
                    disabled={!canAct || (state.phase === "playing" ? Boolean(piece) : state.phase === "choose-piece" ? !removable : true)}
                    onClick={() => handleCell(rowIndex, colIndex)}
                    aria-label={`${rowIndex + 1}행 ${colIndex + 1}열${piece ? ` ${owner?.name ?? "플레이어"} ${piece.size === "small" ? "작은 말" : "큰 말"}` : " 빈 자리"}`}
                  >
                    {piece ? (
                      <span
                        key={`${piece.id}-${state.actionNonce}`}
                        className={`kkuk-piece ${piece.size} ${boop?.to ? "booped" : ""}`}
                        style={pieceStyle}
                        aria-hidden="true"
                      >
                        <img
                          className="kkuk-piece-image"
                          src={markerFor(piece, owner)}
                          alt=""
                          draggable={false}
                        />
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
            <div className="kkuk-effect-layer" aria-hidden="true">
              {state.lastPlaced ? (
                <span
                  className="kkuk-effect place"
                  style={{ gridColumn: state.lastPlaced.col + 1, gridRow: state.lastPlaced.row + 1 } as CSSProperties}
                />
              ) : null}
              {state.boopTrace.map((trace, index) => {
                const effectCoord = trace.to ?? trace.from;
                const effectOwner = state.players.find((player) => player.id === trace.ownerId);
                return (
                  <span
                    key={`${trace.pieceId}-${state.actionNonce}-${index}`}
                    className={`kkuk-effect ${trace.to ? "push" : "out"}`}
                    style={
                      {
                        gridColumn: effectCoord.col + 1,
                        gridRow: effectCoord.row + 1,
                        "--piece-color": effectOwner?.color ?? "#c46d43"
                      } as CSSProperties
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>

        <aside className="kkuk-side" aria-label="꾹꾹이 조작">
          <div className="kkuk-piece-selector">
            <strong>놓을 말</strong>
            <div className="kkuk-selector-row">
              <button
                type="button"
                className={selectedSize === "small" ? "selected" : ""}
                disabled={!activeReserve || activeReserve.small <= 0 || state.phase !== "playing"}
                onClick={() => setSelectedSize("small")}
              >
                작은 말 <span>{activeReserve?.small ?? 0}</span>
              </button>
              <button
                type="button"
                className={selectedSize === "large" ? "selected" : ""}
                disabled={!activeReserve || activeReserve.large <= 0 || state.phase !== "playing"}
                onClick={() => setSelectedSize("large")}
              >
                큰 말 <span>{activeReserve?.large ?? 0}</span>
              </button>
            </div>
          </div>

          <div className="kkuk-player-stack">
            {state.players.map((player) => {
              const reserve = state.reserves[player.id] ?? { small: 0, large: 0 };
              const boardCount = pieceCountOnBoard(state, player.id);
              const snapshot = players.find((candidate) => candidate.id === player.id);
              return (
                <div className={`kkuk-player ${player.id === state.activePlayerId ? "active" : ""}`} key={player.id}>
                  <span className="kkuk-color-dot" style={{ "--piece-color": player.color } as CSSProperties} aria-hidden="true" />
                  <div>
                    <strong>{snapshot?.name ?? player.name}</strong>
                    <small>판 {boardCount} · 작 {reserve.small} · 큰 {reserve.large}</small>
                  </div>
                </div>
              );
            })}
          </div>

          {state.phase === "choose-line" ? (
            <div className="kkuk-line-picker" aria-label="승급 줄 선택">
              <strong>승급 줄</strong>
              {state.pendingLines.map((line, index) => (
                <button
                  key={line.key}
                  type="button"
                  disabled={!canAct}
                  onClick={() => onAction({ type: "kkukkkuki/choose-line", payload: { lineKey: line.key } })}
                >
                  {index + 1}번 줄
                </button>
              ))}
            </div>
          ) : null}

        </aside>
      </section>
    </div>
  );
}

function phaseLabel(phase: Phase) {
  if (phase === "choose-line") return "승급 선택";
  if (phase === "choose-piece") return "말 회수";
  if (phase === "complete") return "종료";
  return "배치";
}
