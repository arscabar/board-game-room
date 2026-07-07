import type { CSSProperties } from "react";
import { useInteractionGate } from "../useInteractionGate";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const BOARD_SIZE = 15;
const playerStones = ["black", "white"] as const;
const directions = [
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: -1 }
] as const;

type StoneColor = (typeof playerStones)[number];

interface Coord {
  row: number;
  col: number;
}

interface OmokPlayer {
  id: string;
  name: string;
  seat: number;
  stone: StoneColor;
}

interface OmokState {
  boardSize: number;
  players: OmokPlayer[];
  board: Array<Array<string | null>>;
  phase: "playing" | "complete" | "draw";
  activePlayerId: string | null;
  winnerId: string | null;
  winnerIds: string[];
  message: string;
  lastMove: (Coord & { playerId: string }) | null;
  winningLine: Coord[];
}

interface PlacePayload {
  row: number;
  col: number;
}

function assertOmokState(state: unknown): OmokState {
  if (!state || typeof state !== "object") {
    throw new Error("오목 상태가 올바르지 않습니다.");
  }
  return state as OmokState;
}

function isPlacePayload(value: unknown): value is PlacePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return Number.isInteger(payload.row) && Number.isInteger(payload.col);
}

function inBoard(row: number, col: number) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function key(coord: Coord) {
  return `${coord.row},${coord.col}`;
}

function cloneBoard(board: OmokState["board"]) {
  return board.map((row) => [...row]);
}

function cloneState(state: OmokState): OmokState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    board: cloneBoard(state.board),
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    winningLine: state.winningLine.map((coord) => ({ ...coord })),
    winnerIds: [...state.winnerIds]
  };
}

function connectedOrder(state: OmokState, context: GameContext) {
  const connectedIds = new Set(context.players.filter((player) => player.connected).map((player) => player.id));
  return state.players.filter((player) => connectedIds.has(player.id));
}

function nextTurn(state: OmokState, context: GameContext) {
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

function requireActivePlayer(state: OmokState, context: GameContext) {
  if (state.phase !== "playing" || state.winnerId) {
    throw new Error("이미 끝난 오목입니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("현재 차례의 플레이어만 돌을 놓을 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("오목 플레이어를 찾을 수 없습니다.");
  }
  return player;
}

function collectRun(board: OmokState["board"], playerId: string, origin: Coord, delta: Coord) {
  const line: Coord[] = [{ ...origin }];

  for (const sign of [-1, 1]) {
    let row = origin.row + delta.row * sign;
    let col = origin.col + delta.col * sign;
    while (inBoard(row, col) && board[row][col] === playerId) {
      if (sign < 0) {
        line.unshift({ row, col });
      } else {
        line.push({ row, col });
      }
      row += delta.row * sign;
      col += delta.col * sign;
    }
  }

  return line;
}

function winningLine(board: OmokState["board"], playerId: string, origin: Coord) {
  for (const direction of directions) {
    const line = collectRun(board, playerId, origin, direction);
    if (line.length >= 5) {
      return line;
    }
  }
  return [];
}

function boardIsFull(board: OmokState["board"]) {
  return board.every((row) => row.every(Boolean));
}

function placeStone(state: OmokState, action: GameAction, context: GameContext): GameActionResult {
  if (!isPlacePayload(action.payload)) {
    throw new Error("돌을 놓을 좌표가 필요합니다.");
  }
  const player = requireActivePlayer(state, context);
  const { row, col } = action.payload;
  if (!inBoard(row, col)) {
    throw new Error("보드 밖에는 돌을 놓을 수 없습니다.");
  }
  if (state.board[row][col]) {
    throw new Error("이미 돌이 놓인 자리입니다.");
  }

  const next = cloneState(state);
  next.board[row][col] = player.id;
  next.lastMove = { row, col, playerId: player.id };

  const line = winningLine(next.board, player.id, { row, col });
  if (line.length >= 5) {
    next.phase = "complete";
    next.activePlayerId = null;
    next.winnerId = player.id;
    next.winnerIds = [player.id];
    next.winningLine = line;
    next.message = `${player.name}님이 5목을 완성했습니다.`;
    return {
      state: next,
      log: `${player.name} 오목 완성`,
      activePlayerId: null,
      turnNumber: context.turnNumber + 1,
      phase: "complete",
      message: next.message,
      winnerId: player.id,
      winnerIds: [player.id]
    };
  }

  if (boardIsFull(next.board)) {
    next.phase = "draw";
    next.activePlayerId = null;
    next.message = "둘 곳이 없어 무승부입니다.";
    return {
      state: next,
      log: "오목 무승부",
      activePlayerId: null,
      turnNumber: context.turnNumber + 1,
      phase: "finished",
      message: next.message,
      winnerId: null,
      winnerIds: []
    };
  }

  const turn = nextTurn(next, context);
  const nextPlayerName = next.players.find((candidate) => candidate.id === turn.activePlayerId)?.name ?? "다음 플레이어";
  next.activePlayerId = turn.activePlayerId;
  next.message = `${nextPlayerName}님 차례입니다.`;
  return {
    state: next,
    log: `${player.name} ${row + 1}-${col + 1}`,
    activePlayerId: turn.activePlayerId,
    turnNumber: turn.turnNumber,
    roundNumber: turn.roundNumber,
    phase: "playing",
    message: next.message
  };
}

function createInitialState({ players }: Pick<GameContext, "players">): OmokState {
  const seatedPlayers = players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 2);
  const modulePlayers = seatedPlayers.map((player, index): OmokPlayer => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    stone: playerStones[index] ?? "black"
  }));
  const firstPlayer = modulePlayers[0] ?? null;

  return {
    boardSize: BOARD_SIZE,
    players: modulePlayers,
    board: Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null)),
    phase: "playing",
    activePlayerId: firstPlayer?.id ?? null,
    winnerId: null,
    winnerIds: [],
    message: firstPlayer ? `${firstPlayer.name}님이 흑으로 시작합니다.` : "2명이 모이면 시작할 수 있습니다.",
    lastMove: null,
    winningLine: []
  };
}

export const module: GameModule = {
  id: "omok",
  createInitialState,
  getPublicState: (state) => assertOmokState(state),
  applyAction: (state, action, context) => {
    const currentState = assertOmokState(state);
    if (action.type !== "omok/place-stone") {
      throw new Error("지원하지 않는 오목 행동입니다.");
    }
    return placeStone(currentState, action, context);
  }
};

export function Component({
  players,
  currentPlayer,
  activePlayer,
  publicState,
  disabled,
  onAction
}: GameComponentProps<OmokState>) {
  const state = assertOmokState(publicState);
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [state.activePlayerId, state.lastMove?.row, state.lastMove?.col, state.phase],
    { cooldownMs: 500 }
  );
  const winningKeys = new Set(state.winningLine.map(key));
  const isMyTurn = currentPlayer?.id === state.activePlayerId;
  const canPlace = !disabled && isMyTurn && state.phase === "playing";
  const activeModulePlayer = state.players.find((player) => player.id === state.activePlayerId) ?? null;
  const activeStone = activeModulePlayer?.stone ?? "black";
  const lastMoveOwner = state.lastMove ? state.players.find((player) => player.id === state.lastMove?.playerId) : null;
  const lastMoveLabel = state.lastMove
    ? `${lastMoveOwner?.name ?? "플레이어"} · ${state.lastMove.row + 1}행 ${state.lastMove.col + 1}열`
    : "아직 없음";
  const lastMoveShortLabel = state.lastMove ? `${state.lastMove.row + 1}-${state.lastMove.col + 1}` : "-";
  const turnBadgeLabel =
    state.phase !== "playing" ? (state.phase === "draw" ? "무승부" : "종료") : isMyTurn ? "내 차례" : "대기";

  function placeAt(row: number, col: number) {
    if (!canPlace || isSubmitting || !inBoard(row, col) || state.board[row][col]) {
      return;
    }
    submitAction({ type: "omok/place-stone", payload: { row, col } });
  }

  return (
    <div className={`game-module omok-shell ${isSubmitting ? "is-submitting" : ""}`}>
      <section className="omok-status" aria-label="오목 진행 상태">
        <div className={`omok-status-card omok-turn-card ${isMyTurn ? "my-turn" : ""}`}>
          <strong>차례</strong>
          <span className="omok-turn-line">
            {activeModulePlayer ? <i className={`omok-status-stone ${activeStone}`} aria-hidden="true" /> : null}
            <b>{activePlayer?.name ?? activeModulePlayer?.name ?? "종료"}</b>
            <em>{turnBadgeLabel}</em>
          </span>
        </div>
        <div className="omok-status-message">
          <p>{state.message}</p>
        </div>
        <div className="omok-status-card omok-last-card" aria-label={`마지막 수 ${lastMoveLabel}`}>
          <strong>마지막</strong>
          <span className="omok-last-line" title={lastMoveLabel}>
            <b>{lastMoveShortLabel}</b>
            <em>{lastMoveOwner ? (lastMoveOwner.stone === "black" ? "흑" : "백") : "없음"}</em>
          </span>
        </div>
      </section>

      <section className="omok-layout" aria-label="오목판">
        <div className="omok-board-wrap">
          <div className="omok-board" style={{ "--omok-size": BOARD_SIZE } as CSSProperties}>
            {state.board.map((row, rowIndex) =>
              row.map((ownerId, colIndex) => {
                const owner = state.players.find((player) => player.id === ownerId);
                const isLast = state.lastMove?.row === rowIndex && state.lastMove.col === colIndex;
                const isWinning = winningKeys.has(key({ row: rowIndex, col: colIndex }));
                return (
                  <button
                    key={`${rowIndex}-${colIndex}`}
                    className={`omok-point ${owner?.stone ?? ""} ${isLast ? "last" : ""} ${isWinning ? "winning" : ""}`}
                    type="button"
                    disabled={!canPlace || isSubmitting || Boolean(ownerId)}
                    aria-label={`${rowIndex + 1}행 ${colIndex + 1}열${owner ? ` ${owner.name} 돌` : " 빈 자리"}${isLast ? " 마지막 수" : ""}`}
                    onClick={() => placeAt(rowIndex, colIndex)}
                  >
                    {owner ? <span className={`omok-stone ${owner.stone}`} aria-hidden="true" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <aside className="omok-side" aria-label="플레이어 돌">
          {state.players.map((player) => {
            const snapshot = players.find((candidate) => candidate.id === player.id);
            const stoneCount = state.board.reduce((total, row) => total + row.filter((ownerId) => ownerId === player.id).length, 0);
            return (
              <div className={`omok-player-card ${player.id === state.activePlayerId ? "active" : ""}`} key={player.id}>
                <span className={`omok-stone sample ${player.stone}`} aria-hidden="true" />
                <div>
                  <strong>{snapshot?.name ?? player.name}</strong>
                  <small>{stoneCount}수</small>
                </div>
              </div>
            );
          })}
        </aside>
      </section>
    </div>
  );
}
