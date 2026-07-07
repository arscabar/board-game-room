import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";
import { useInteractionGate } from "../useInteractionGate";

const BOARD_SIZE = 6;

type GhostKind = "good" | "bad";
type Side = "south" | "north";

interface Coord {
  row: number;
  col: number;
}

interface GhostsPlayer {
  id: string;
  name: string;
  seat: number;
  side: Side;
  color: string;
}

interface GhostPiece {
  id: string;
  ownerId: string;
  kind: GhostKind | null;
  row: number;
  col: number;
  captured: boolean;
  escaped: boolean;
  capturedBy?: string;
}

interface GhostsState {
  players: GhostsPlayer[];
  pieces: GhostPiece[];
  phase: "setup" | "playing" | "complete";
  setupSubmitted: Record<string, boolean>;
  winnerId: string | null;
  message: string;
}

interface PublicGhostPiece {
  id: string;
  ownerId: string;
  kind: GhostKind | null;
  row: number;
  col: number;
  captured: boolean;
  escaped: boolean;
}

interface GhostsPublicState {
  boardSize: number;
  players: GhostsPlayer[];
  pieces: PublicGhostPiece[];
  phase: "setup" | "playing" | "complete";
  setupSubmitted: Record<string, boolean>;
  winnerId: string | null;
  message: string;
  viewerId: string | null;
}

interface MovePayload {
  pieceId: string;
  to: Coord;
}

interface SetupPayload {
  kinds: GhostKind[];
}

interface CaptureEffect {
  id: string;
  row: number;
  col: number;
  kind: GhostKind;
  nonce: number;
}

const playerColors = ["#425a9e", "#9d3f47"];
const kindPattern: GhostKind[] = ["bad", "good", "good", "bad", "good", "bad", "bad", "good"];

function isCoord(value: unknown): value is Coord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.row) && Number.isInteger(item.col);
}

function isMovePayload(value: unknown): value is MovePayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.pieceId === "string" && isCoord(item.to);
}

function isSetupPayload(value: unknown): value is SetupPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Array.isArray(item.kinds) && item.kinds.every((kind) => kind === "good" || kind === "bad");
}

function inBoard(row: number, col: number) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function pieceAt(state: GhostsState, row: number, col: number) {
  return state.pieces.find((piece) => !piece.captured && !piece.escaped && piece.row === row && piece.col === col) ?? null;
}

function cloneState(state: GhostsState): GhostsState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    pieces: state.pieces.map((piece) => ({ ...piece })),
    setupSubmitted: { ...state.setupSubmitted }
  };
}

function setupCoords(side: Side) {
  const backRow = side === "south" ? 5 : 0;
  const frontRow = side === "south" ? 4 : 1;
  return [
    { row: backRow, col: 1 },
    { row: backRow, col: 2 },
    { row: backRow, col: 3 },
    { row: backRow, col: 4 },
    { row: frontRow, col: 1 },
    { row: frontRow, col: 2 },
    { row: frontRow, col: 3 },
    { row: frontRow, col: 4 }
  ];
}

function createPiecesForPlayer(player: GhostsPlayer, playerIndex: number) {
  return setupCoords(player.side).map((coord, index): GhostPiece => ({
    id: `p${playerIndex + 1}-ghost-${index + 1}`,
    ownerId: player.id,
    kind: null,
    row: coord.row,
    col: coord.col,
    captured: false,
    escaped: false
  }));
}

function connectedModulePlayers(state: GhostsState, context: GameContext) {
  const connectedIds = new Set(context.players.filter((player) => player.connected).map((player) => player.id));
  return state.players.filter((player) => connectedIds.has(player.id));
}

function advanceTurn(state: GhostsState, context: GameContext) {
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

function requireActivePlayer(state: GhostsState, context: GameContext) {
  if (state.winnerId) {
    throw new Error("이미 종료된 게임입니다.");
  }
  if (state.phase !== "playing") {
    throw new Error("두 플레이어가 유령 배치를 제출한 뒤 이동할 수 있습니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("고스트 플레이어를 찾을 수 없습니다.");
  }
  return player;
}

function opponentOf(state: GhostsState, playerId: string) {
  return state.players.find((player) => player.id !== playerId) ?? null;
}

function allGoodGhostsCaptured(state: GhostsState, ownerId: string) {
  const goodGhosts = state.pieces.filter((piece) => piece.ownerId === ownerId && piece.kind === "good");
  return goodGhosts.length > 0 && goodGhosts.every((piece) => piece.captured);
}

function allBadGhostsCaptured(state: GhostsState, ownerId: string) {
  const badGhosts = state.pieces.filter((piece) => piece.ownerId === ownerId && piece.kind === "bad");
  return badGhosts.length > 0 && badGhosts.every((piece) => piece.captured);
}

function exitRowFor(player: GhostsPlayer) {
  return player.side === "south" ? -1 : BOARD_SIZE;
}

function opponentBackRowFor(player: GhostsPlayer) {
  return player.side === "south" ? 0 : BOARD_SIZE - 1;
}

function canEscape(player: GhostsPlayer, piece: GhostPiece, target: Coord) {
  return (
    piece.kind === "good" &&
    !piece.captured &&
    !piece.escaped &&
    piece.ownerId === player.id &&
    piece.row === opponentBackRowFor(player) &&
    (piece.col === 0 || piece.col === BOARD_SIZE - 1) &&
    target.row === exitRowFor(player) &&
    target.col === piece.col
  );
}

function winnerAfterCapture(state: GhostsState, movingPlayerId: string, capturedOwnerId: string, capturedKind: GhostKind) {
  if (capturedKind === "good" && allGoodGhostsCaptured(state, capturedOwnerId)) {
    return movingPlayerId;
  }
  for (const player of state.players) {
    if (allBadGhostsCaptured(state, player.id)) {
      return player.id;
    }
  }
  return null;
}

function finishForWinner(state: GhostsState, winnerId: string, message: string, log: string): GameActionResult {
  state.winnerId = winnerId;
  state.phase = "complete";
  state.message = message;
  return {
    state,
    log,
    activePlayerId: null,
    phase: "complete",
    message,
    winnerId
  };
}

function moveGhost(state: GhostsState, action: GameAction, context: GameContext): GameActionResult {
  if (!isMovePayload(action.payload)) {
    throw new Error("움직일 유령과 목표 칸이 필요합니다.");
  }

  const payload = action.payload;
  const player = requireActivePlayer(state, context);
  const piece = state.pieces.find((candidate) => candidate.id === payload.pieceId);
  if (!piece || piece.ownerId !== player.id || piece.captured || piece.escaped) {
    throw new Error("움직일 수 있는 내 유령을 선택하세요.");
  }

  const target = payload.to;
  const orthogonalStep = Math.abs(target.row - piece.row) + Math.abs(target.col - piece.col) === 1;
  if (!orthogonalStep) {
    throw new Error("유령은 상하좌우로 한 칸만 이동합니다.");
  }

  const next = cloneState(state);
  const nextPiece = next.pieces.find((candidate) => candidate.id === piece.id);
  if (!nextPiece) {
    throw new Error("유령을 찾을 수 없습니다.");
  }

  if (!inBoard(target.row, target.col)) {
    if (!canEscape(player, nextPiece, target)) {
      throw new Error("상대 쪽 모서리에 있는 좋은 유령만 탈출할 수 있습니다.");
    }

    nextPiece.escaped = true;
    return finishForWinner(
      next,
      player.id,
      `${player.name}님이 좋은 유령을 모서리로 탈출시켰습니다.`,
      `${player.name} 좋은 유령 탈출 승리`
    );
  }

  const occupant = pieceAt(next, target.row, target.col);
  if (occupant?.ownerId === player.id) {
    throw new Error("자기 유령이 있는 칸으로는 이동할 수 없습니다.");
  }

  let captureText = "";
  let capturedKind: GhostKind | null = null;
  if (occupant) {
    if (!occupant.kind) {
      throw new Error("상대 유령 배치가 아직 확정되지 않았습니다.");
    }
    capturedKind = occupant.kind;
    occupant.captured = true;
    occupant.capturedBy = player.id;
    captureText = ` · ${capturedKind === "good" ? "좋은" : "나쁜"} 유령 포획`;
  }

  nextPiece.row = target.row;
  nextPiece.col = target.col;

  if (occupant && capturedKind) {
    const winnerId = winnerAfterCapture(next, player.id, occupant.ownerId, capturedKind);
    if (winnerId) {
      const winner = next.players.find((candidate) => candidate.id === winnerId);
      const reason =
        winnerId === player.id
          ? "상대의 좋은 유령을 모두 잡았습니다"
          : "자기 나쁜 유령이 모두 잡혔습니다";
      return finishForWinner(
        next,
        winnerId,
        `${winner?.name ?? "플레이어"}님 승리: ${reason}.`,
        `${winner?.name ?? "플레이어"} ${reason}`
      );
    }
  }

  next.message = `${player.name}님이 ${target.row + 1}-${target.col + 1}칸으로 이동했습니다${captureText}.`;
  return {
    state: next,
    log: `${player.name} 유령 이동${captureText}`,
    message: next.message,
    phase: "playing",
    winnerId: null,
    ...advanceTurn(next, context)
  };
}

function createInitialState(context: Pick<GameContext, "game" | "players">): GhostsState {
  const seatedPlayers = context.players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 2);

  const players = seatedPlayers.map((player, index): GhostsPlayer => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    side: index === 0 ? "south" : "north",
    color: playerColors[index] ?? "#17201d"
  }));

  return {
    players,
    pieces: players.flatMap((player, index) => createPiecesForPlayer(player, index)),
    phase: "setup",
    setupSubmitted: Object.fromEntries(players.map((player) => [player.id, false])),
    winnerId: null,
    message: "각자 좋은 유령 4개와 나쁜 유령 4개의 위치를 비공개로 정하세요."
  };
}

export const module: GameModule = {
  id: "ghosts",
  createInitialState,
  getPublicState: (state, context): GhostsPublicState => {
    const ghostsState = state as GhostsState;
    return {
      boardSize: BOARD_SIZE,
      players: ghostsState.players.map((player) => ({ ...player })),
      pieces: ghostsState.pieces.map((piece) => ({
        id: piece.id,
        ownerId: piece.ownerId,
        kind: piece.ownerId === context.viewerId || piece.captured || piece.escaped ? piece.kind : null,
        row: piece.row,
        col: piece.col,
        captured: piece.captured,
        escaped: piece.escaped
      })),
      phase: ghostsState.phase,
      setupSubmitted: { ...ghostsState.setupSubmitted },
      winnerId: ghostsState.winnerId,
      message: ghostsState.message,
      viewerId: context.viewerId
    };
  },
  applyAction: (state, action, context) => {
    const ghostsState = state as GhostsState;
    if (action.type === "ghosts/setup") {
      return setupGhosts(ghostsState, action, context);
    }
    if (action.type === "moveGhost") {
      return moveGhost(ghostsState, action, context);
    }
    throw new Error("지원하지 않는 고스트 행동입니다.");
  }
};

function setupGhosts(state: GhostsState, action: GameAction, context: GameContext): GameActionResult {
  if (state.phase !== "setup") {
    throw new Error("이미 유령 배치가 확정되었습니다.");
  }
  if (!isSetupPayload(action.payload)) {
    throw new Error("좋은 유령 4개와 나쁜 유령 4개의 배치가 필요합니다.");
  }

  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("고스트 플레이어를 찾을 수 없습니다.");
  }
  if (state.setupSubmitted[player.id]) {
    throw new Error("이미 유령 배치를 제출했습니다.");
  }

  const kinds = action.payload.kinds.slice(0, 8);
  const goodCount = kinds.filter((kind) => kind === "good").length;
  const badCount = kinds.filter((kind) => kind === "bad").length;
  if (kinds.length !== 8 || goodCount !== 4 || badCount !== 4) {
    throw new Error("좋은 유령 4개와 나쁜 유령 4개가 정확히 필요합니다.");
  }

  const next = cloneState(state);
  const ownPieces = next.pieces.filter((piece) => piece.ownerId === player.id).sort((a, b) => a.id.localeCompare(b.id));
  ownPieces.forEach((piece, index) => {
    piece.kind = kinds[index] ?? null;
  });
  next.setupSubmitted[player.id] = true;

  const ready = next.players.every((candidate) => next.setupSubmitted[candidate.id]);
  if (ready) {
    next.phase = "playing";
    next.message = "모든 유령 배치가 완료되었습니다. 자기 유령을 선택해 이동하세요.";
    return {
      state: next,
      log: `${player.name} 유령 배치 제출`,
      activePlayerId: next.players[0]?.id ?? null,
      phase: "playing",
      message: next.message
    };
  }

  const waiting = next.players.find((candidate) => !next.setupSubmitted[candidate.id]);
  next.message = `${player.name}님이 배치를 제출했습니다. ${waiting?.name ?? "상대"}님의 배치를 기다립니다.`;
  return {
    state: next,
    log: `${player.name} 유령 배치 제출`,
    activePlayerId: waiting?.id ?? context.activePlayerId,
    phase: "setup",
    message: next.message
  };
}

function getPublicPieceAt(state: GhostsPublicState, row: number, col: number) {
  return state.pieces.find((piece) => !piece.captured && !piece.escaped && piece.row === row && piece.col === col) ?? null;
}

function legalTargetsFor(state: GhostsPublicState, player: GhostsPlayer, piece: PublicGhostPiece) {
  const deltas = [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 }
  ];

  const targets = deltas
    .map((delta) => ({ row: piece.row + delta.row, col: piece.col + delta.col }))
    .filter((target) => {
      if (!inBoard(target.row, target.col)) return false;
      const occupant = getPublicPieceAt(state, target.row, target.col);
      return occupant?.ownerId !== player.id;
    });

  if (
    piece.kind === "good" &&
    piece.row === opponentBackRowFor(player) &&
    (piece.col === 0 || piece.col === BOARD_SIZE - 1)
  ) {
    targets.push({ row: exitRowFor(player), col: piece.col });
  }

  return targets;
}

function targetKey(coord: Coord) {
  return `${coord.row},${coord.col}`;
}

function kindLabel(kind: GhostKind | null) {
  if (kind === "good") return "✦";
  if (kind === "bad") return "◆";
  return "?";
}

function publicKindName(kind: GhostKind | null) {
  if (kind === "good") return "좋은";
  if (kind === "bad") return "나쁜";
  return "숨은";
}

function pieceTitle(piece: PublicGhostPiece, owner: GhostsPlayer | undefined) {
  return `${owner?.name ?? "플레이어"} ${publicKindName(piece.kind)} 유령`;
}

function setupDirectionFor(side: Side) {
  return side === "south"
    ? { label: "북쪽 모서리 탈출", arrows: ["↖", "↑", "↗"] }
    : { label: "남쪽 모서리 탈출", arrows: ["↙", "↓", "↘"] };
}

function playerStats(state: GhostsPublicState, playerId: string) {
  const pieces = state.pieces.filter((piece) => piece.ownerId === playerId);
  return {
    active: pieces.filter((piece) => !piece.captured && !piece.escaped).length,
    capturedGood: pieces.filter((piece) => piece.captured && piece.kind === "good").length,
    capturedBad: pieces.filter((piece) => piece.captured && piece.kind === "bad").length,
    escaped: pieces.filter((piece) => piece.escaped).length,
    knownGood: pieces.filter((piece) => !piece.captured && !piece.escaped && piece.kind === "good").length,
    knownBad: pieces.filter((piece) => !piece.captured && !piece.escaped && piece.kind === "bad").length
  };
}

export function Component(props: GameComponentProps) {
  const { activePlayer, currentPlayer, disabled, onAction } = props;
  const publicState = props.publicState as GhostsPublicState;
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [setupKinds, setSetupKinds] = useState<GhostKind[]>(kindPattern);
  const [captureEffect, setCaptureEffect] = useState<CaptureEffect | null>(null);
  const previousCapturedIdsRef = useRef<Set<string> | null>(null);
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const selectedPiece =
    publicState.pieces.find((piece) => piece.id === selectedPieceId && !piece.captured && !piece.escaped) ?? null;
  const canAct =
    !disabled &&
    !publicState.winnerId &&
    Boolean(currentModulePlayer) &&
    currentPlayer?.id === activePlayer?.id;
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [publicState.phase, activePlayer?.id, publicState.message, publicState.winnerId],
    { cooldownMs: 650 }
  );

  const legalTargets = useMemo(() => {
    if (!selectedPiece || !currentModulePlayer || selectedPiece.ownerId !== currentModulePlayer.id) return [];
    return legalTargetsFor(publicState, currentModulePlayer, selectedPiece);
  }, [currentModulePlayer, publicState, selectedPiece]);

  const legalTargetKeys = new Set(legalTargets.map(targetKey));
  const winner = publicState.players.find((player) => player.id === publicState.winnerId);
  const mySetupSubmitted = currentModulePlayer ? publicState.setupSubmitted[currentModulePlayer.id] : false;
  const setupGoodCount = setupKinds.filter((kind) => kind === "good").length;
  const setupBadCount = setupKinds.filter((kind) => kind === "bad").length;

  useEffect(() => {
    const capturedIds = new Set(publicState.pieces.filter((piece) => piece.captured).map((piece) => piece.id));
    if (!previousCapturedIdsRef.current) {
      previousCapturedIdsRef.current = capturedIds;
      return;
    }

    const newlyCaptured = publicState.pieces.find(
      (piece) => piece.captured && piece.kind && !previousCapturedIdsRef.current?.has(piece.id)
    );
    previousCapturedIdsRef.current = capturedIds;
    if (!newlyCaptured?.kind) return;

    setCaptureEffect({
      id: newlyCaptured.id,
      row: newlyCaptured.row,
      col: newlyCaptured.col,
      kind: newlyCaptured.kind,
      nonce: Date.now()
    });
  }, [publicState.pieces]);

  useEffect(() => {
    if (!captureEffect) return undefined;
    const timer = window.setTimeout(() => setCaptureEffect(null), 1000);
    return () => window.clearTimeout(timer);
  }, [captureEffect]);

  function toggleSetupKind(index: number) {
    setSetupKinds((current) =>
      current.map((kind, itemIndex) => (itemIndex === index ? (kind === "good" ? "bad" : "good") : kind))
    );
  }

  function submitSetup() {
    if (isSubmitting || !currentModulePlayer || mySetupSubmitted || setupGoodCount !== 4 || setupBadCount !== 4) return;
    submitAction({ type: "ghosts/setup", payload: { kinds: setupKinds } });
  }

  function selectOrMove(row: number, col: number) {
    if (!canAct || isSubmitting || !currentModulePlayer) return;
    const occupant = getPublicPieceAt(publicState, row, col);
    if (selectedPiece && legalTargetKeys.has(targetKey({ row, col }))) {
      submitAction({ type: "moveGhost", payload: { pieceId: selectedPiece.id, to: { row, col } } });
      setSelectedPieceId(null);
      return;
    }
    if (occupant?.ownerId === currentModulePlayer.id) {
      setSelectedPieceId(occupant.id);
    }
  }

  function escapeAt(col: number, side: Side) {
    if (!canAct || isSubmitting || !selectedPiece || !currentModulePlayer || currentModulePlayer.side !== side) return;
    const target = { row: exitRowFor(currentModulePlayer), col };
    if (!legalTargetKeys.has(targetKey(target))) return;
    submitAction({ type: "moveGhost", payload: { pieceId: selectedPiece.id, to: target } });
    setSelectedPieceId(null);
  }

  return (
    <div className={`gho-shell ${isSubmitting ? "is-submitting" : ""}`}>
      <style>{ghostsStyles}</style>
      {publicState.phase === "setup" ? (
        <section className="gho-setup" aria-label="고스트 비공개 배치">
          <div className="gho-status" aria-live="polite">
            <div>
              <strong>비공개 배치</strong>
              <span>좋은 유령 4개 · 나쁜 유령 4개</span>
            </div>
            <p>{publicState.message}</p>
          </div>

          <div className="gho-setup-grid">
            {publicState.players.map((player) => {
              const isMine = player.id === currentPlayer?.id;
              const submitted = publicState.setupSubmitted[player.id];
              const setupDirection = setupDirectionFor(player.side);
              const ownPieces = publicState.pieces
                .filter((piece) => piece.ownerId === player.id)
                .sort((a, b) => a.id.localeCompare(b.id));
              return (
                <article className={`gho-setup-player ${isMine ? "mine" : ""}`} key={player.id}>
                  <div className="gho-player-headline">
                    <strong>{player.name}</strong>
                    <span>{submitted ? "제출 완료" : isMine ? "배치 선택 중" : "배치 대기"}</span>
                  </div>
                  <div className={`gho-setup-direction ${player.side}`} aria-label={`전진 방향: ${setupDirection.label}`}>
                    {setupDirection.arrows.map((arrow) => (
                      <span aria-hidden="true" key={arrow}>
                        {arrow}
                      </span>
                    ))}
                    <strong>{setupDirection.label}</strong>
                  </div>
                  <div className="gho-setup-slots">
                    {ownPieces.map((piece, index) => {
                      const kind = (isMine && !submitted ? setupKinds[index] : piece.kind) ?? null;
                      return (
                        <button
                          className={`gho-setup-slot ${kind ?? "hidden"}`}
                          disabled={!isMine || submitted || disabled || isSubmitting}
                          key={piece.id}
                          onClick={() => toggleSetupKind(index)}
                          aria-label={`${index + 1}번 ${publicKindName(kind)} 유령`}
                          type="button"
                        >
                          <span className="gho-kind-symbol">
                            {isMine ? kindLabel(kind) : submitted ? "✓" : "?"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {isMine && !submitted ? (
                    <div className="gho-setup-actions">
                      <span>
                        좋은 {setupGoodCount}/4 · 나쁜 {setupBadCount}/4
                      </span>
                      <button disabled={disabled || isSubmitting || setupGoodCount !== 4 || setupBadCount !== 4} onClick={submitSetup} type="button">
                        배치 제출
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <>
          <div className="gho-status" aria-live="polite">
            <div>
              <strong>{publicState.winnerId ? "승자" : "차례"}</strong>
              <span>{publicState.winnerId ? winner?.name ?? "완료" : activeModulePlayer?.name ?? "대기"}</span>
            </div>
            <p>{publicState.message}</p>
          </div>

          <div className="gho-layout">
        <div className="gho-board-wrap">
          <div className="gho-exits top" aria-label="북쪽 탈출 모서리">
            {[0, BOARD_SIZE - 1].map((col) => {
              const legal = Boolean(
                selectedPiece &&
                  currentModulePlayer?.side === "south" &&
                  legalTargetKeys.has(targetKey({ row: -1, col }))
              );
              return (
                <button
                  className={legal ? "legal" : ""}
                  disabled={!legal || isSubmitting}
                  key={`north-${col}`}
                  onClick={() => escapeAt(col, "south")}
                  style={{ gridColumn: col + 1 } as CSSProperties}
                  title={`북쪽 ${col + 1}번 모서리 탈출`}
                  type="button"
                >
                  탈출
                </button>
              );
            })}
          </div>

          <div className="gho-board" aria-label="고스트 보드">
            {Array.from({ length: BOARD_SIZE }, (_, row) =>
              Array.from({ length: BOARD_SIZE }, (_, col) => {
                const piece = getPublicPieceAt(publicState, row, col);
                const owner = publicState.players.find((player) => player.id === piece?.ownerId);
                const selected = selectedPieceId === piece?.id;
                const legal = legalTargetKeys.has(targetKey({ row, col }));
                const ownPiece = piece?.ownerId === currentModulePlayer?.id;
                const captureFx =
                  captureEffect && captureEffect.row === row && captureEffect.col === col ? captureEffect : null;
                return (
                  <button
                    className={`gho-cell ${legal ? "legal" : ""} ${selected ? "selected" : ""} ${
                      captureFx ? `captured-${captureFx.kind}` : ""
                    }`}
                    disabled={!canAct || isSubmitting || (!ownPiece && !legal)}
                    key={targetKey({ row, col })}
                    onClick={() => selectOrMove(row, col)}
                    title={`${row + 1}행 ${col + 1}열`}
                    type="button"
                  >
                    {piece ? (
                      <span
                        className={`gho-token ${piece.kind ?? "hidden"} ${ownPiece ? "own" : "opponent"}`}
                        style={{ "--ghost-color": owner?.color ?? "#17201d" } as CSSProperties}
                        title={pieceTitle(piece, owner)}
                      >
                        <span className="gho-kind-symbol">{kindLabel(piece.kind)}</span>
                      </span>
                    ) : legal ? (
                      <span className="gho-move-dot" />
                    ) : null}
                    {captureFx ? (
                      <span
                        className={`gho-capture-fx ${captureFx.kind}`}
                        key={`${captureFx.id}-${captureFx.nonce}`}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="gho-exits bottom" aria-label="남쪽 탈출 모서리">
            {[0, BOARD_SIZE - 1].map((col) => {
              const legal = Boolean(
                selectedPiece &&
                  currentModulePlayer?.side === "north" &&
                  legalTargetKeys.has(targetKey({ row: BOARD_SIZE, col }))
              );
              return (
                <button
                  className={legal ? "legal" : ""}
                  disabled={!legal || isSubmitting}
                  key={`south-${col}`}
                  onClick={() => escapeAt(col, "north")}
                  style={{ gridColumn: col + 1 } as CSSProperties}
                  title={`남쪽 ${col + 1}번 모서리 탈출`}
                  type="button"
                >
                  탈출
                </button>
              );
            })}
          </div>
        </div>

        <aside className="gho-panel" aria-label="유령 상태">
          {publicState.players.map((player) => {
            const stats = playerStats(publicState, player.id);
            const isCurrent = player.id === currentPlayer?.id;
            return (
              <div className="gho-player" key={player.id}>
                <span className="gho-swatch" style={{ background: player.color }} />
                <div>
                  <strong>{player.name}</strong>
                  <span>{isCurrent ? "내 플레이어" : player.side === "south" ? "남쪽" : "북쪽"}</span>
                </div>
                <dl>
                  <div>
                    <dt>활동</dt>
                    <dd>{stats.active}</dd>
                  </div>
                  <div>
                    <dt>잡힌 좋은 유령</dt>
                    <dd>{stats.capturedGood}</dd>
                  </div>
                  <div>
                    <dt>잡힌 나쁜 유령</dt>
                    <dd>{stats.capturedBad}</dd>
                  </div>
                  {isCurrent ? (
                    <>
                      <div>
                        <dt>내 좋은 유령</dt>
                        <dd>{stats.knownGood}</dd>
                      </div>
                      <div>
                        <dt>내 나쁜 유령</dt>
                        <dd>{stats.knownBad}</dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              </div>
            );
          })}
        </aside>
          </div>
        </>
      )}
    </div>
  );
}

const ghostsStyles = `
.gho-shell {
  display: grid;
  gap: 14px;
  color: #17201d;
}
.gho-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(46, 77, 132, 0.24);
  border-radius: 8px;
  padding: 12px;
  background:
    linear-gradient(180deg, #eef5ff, #d8e7fa);
}
.gho-status strong,
.gho-status span {
  display: block;
}
.gho-status span,
.gho-status p {
  color: #52625d;
}
.gho-status p {
  margin: 0;
  text-align: right;
}
.gho-setup {
  display: grid;
  gap: 14px;
}
.gho-setup-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.gho-setup-player {
  display: grid;
  gap: 12px;
  border: 1px solid rgba(46, 77, 132, 0.22);
  border-radius: 8px;
  padding: 12px;
  background: linear-gradient(180deg, #fbfdff, #e5eefb);
}
.gho-setup-player.mine {
  border-color: rgba(214, 155, 45, 0.42);
  background: linear-gradient(180deg, #fffaf0, #e9f1ff);
}
.gho-player-headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.gho-player-headline strong,
.gho-player-headline span {
  display: block;
}
.gho-player-headline span {
  color: #52625d;
  font-size: 0.84rem;
  font-weight: 800;
}
.gho-setup-direction {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  align-items: center;
  border: 1px solid rgba(46, 77, 132, 0.18);
  border-radius: 8px;
  padding: 7px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(218, 231, 248, 0.72));
  color: #29457d;
  text-align: center;
}
.gho-setup-direction span {
  display: grid;
  place-items: center;
  min-height: 28px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.72);
  font-size: 1.05rem;
  font-weight: 950;
}
.gho-setup-direction strong {
  grid-column: 1 / -1;
  color: #52625d;
  font-size: 0.78rem;
}
.gho-setup-slots {
  display: grid;
  grid-template-columns: repeat(4, minmax(44px, 1fr));
  gap: 8px;
}
.gho-setup-slot {
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
  min-height: 58px;
  border: 2px solid rgba(46, 77, 132, 0.22);
  border-radius: 999px 999px 42% 42%;
  background:
    radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.96), transparent 26%),
    #f9fbff;
  color: #17201d;
  font-weight: 900;
}
.gho-setup-slot.good {
  background:
    radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.96), transparent 26%),
    #f7fff8;
}
.gho-setup-slot.bad {
  background:
    radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.96), transparent 26%),
    #fff8f5;
}
.gho-setup-slot.hidden {
  border-style: dashed;
  color: #52625d;
}
.gho-kind-symbol {
  position: relative;
  z-index: 2;
  display: grid;
  place-items: center;
  min-width: 1em;
  font-size: 1rem;
  line-height: 1;
}
.gho-setup-slot .gho-kind-symbol {
  font-size: 1.08rem;
  font-weight: 950;
}
.gho-setup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}
.gho-setup-actions span {
  color: #52625d;
  font-weight: 800;
}
.gho-setup-actions button {
  min-height: 42px;
  border: 1px solid rgba(46, 77, 132, 0.28);
  border-radius: 8px;
  padding: 0 14px;
  background: #29457d;
  color: white;
  font-weight: 900;
}
.gho-layout {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 260px;
  gap: 16px;
  align-items: start;
}
.gho-board-wrap {
  display: grid;
  gap: 8px;
  justify-items: center;
  border: 1px solid rgba(46, 77, 132, 0.2);
  border-radius: 8px;
  padding: 10px;
  background:
    linear-gradient(180deg, #f3f8ff, #dfeeff);
}
.gho-board,
.gho-exits {
  display: grid;
  grid-template-columns: repeat(6, minmax(34px, 1fr));
  gap: 5px;
  width: min(100%, 500px);
}
.gho-board {
  aspect-ratio: 1;
  padding: 10px;
  border: 1px solid rgba(46, 77, 132, 0.38);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.14) 0 1px, transparent 1px 32px),
    linear-gradient(0deg, rgba(255, 255, 255, 0.12) 0 1px, transparent 1px 32px),
    linear-gradient(135deg, #5d74bd, #29457d);
  box-shadow:
    inset 0 0 0 4px rgba(255, 255, 255, 0.14),
    0 14px 24px rgba(26, 45, 83, 0.18);
}
.gho-cell {
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
  min-height: 0;
  aspect-ratio: 1;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 4px;
  padding: 0;
  background:
    radial-gradient(circle at center, rgba(255, 255, 255, 0.16), transparent 58%),
    #334f91;
  color: #17201d;
}
.gho-cell.legal {
  border-color: #e5c55c;
  background:
    radial-gradient(circle at center, rgba(229, 197, 92, 0.42), transparent 62%),
    #334f91;
}
.gho-cell.selected {
  outline: 3px solid #d69b2d;
  outline-offset: -3px;
}
.gho-token {
  display: grid;
  place-items: center;
  position: relative;
  z-index: 1;
  width: 70%;
  aspect-ratio: 0.82;
  border: 2px solid rgba(38, 54, 91, 0.22);
  border-radius: 999px 999px 42% 42%;
  background:
    radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.96), transparent 26%),
    #f9fbff;
  color: #17201d;
  font-weight: 900;
  box-shadow:
    inset 0 -7px 9px rgba(44, 62, 104, 0.12),
    0 7px 10px rgba(26, 45, 83, 0.24);
}
.gho-token::after {
  content: "";
  position: absolute;
  right: 18%;
  bottom: 14%;
  width: 25%;
  aspect-ratio: 1;
  border-radius: 999px;
  background: var(--ghost-color);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.82);
}
.gho-token.good {
  background:
    radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.96), transparent 26%),
    #f7fff8;
}
.gho-token.bad {
  background:
    radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.96), transparent 26%),
    #fff8f5;
}
.gho-token.hidden {
  background:
    radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.96), transparent 26%),
    #f9fbff;
}
.gho-token.opponent {
  border-style: dashed;
}
.gho-token.hidden .gho-kind-symbol {
  opacity: 0;
}
.gho-token.opponent::after {
  background: #9aa9c4;
}
.gho-move-dot {
  width: 28%;
  aspect-ratio: 1;
  border-radius: 999px;
  background: #28777c;
}
.gho-exits button {
  min-height: 36px;
  border: 1px dashed rgba(46, 77, 132, 0.32);
  border-radius: 8px;
  background: #e9f2ff;
  color: #29457d;
  font-size: 0.82rem;
  font-weight: 800;
}
.gho-exits button.legal {
  border-color: #e5c55c;
  background: #29457d;
  color: white;
}
.gho-capture-fx {
  position: absolute;
  inset: 8%;
  z-index: 4;
  pointer-events: none;
  display: grid;
  place-items: center;
}
.gho-capture-fx::before {
  content: "";
  position: absolute;
  inset: 12%;
  border: 3px solid #65a8ff;
  border-radius: 999px;
  animation: gho-capture-ring 900ms ease-out both;
}
.gho-capture-fx::after {
  content: "✦";
  position: absolute;
  color: #eef7ff;
  font-size: 1.35rem;
  font-weight: 950;
  text-shadow:
    0 0 8px rgba(76, 151, 255, 0.88),
    0 0 18px rgba(255, 255, 255, 0.72);
  animation: gho-capture-mark 900ms ease-out both;
}
.gho-capture-fx.bad::before {
  border-color: #e35a74;
}
.gho-capture-fx.bad::after {
  content: "◆";
  color: #fff0f3;
  text-shadow:
    0 0 8px rgba(227, 90, 116, 0.88),
    0 0 18px rgba(255, 255, 255, 0.64);
}
@keyframes gho-capture-ring {
  0% {
    opacity: 0.95;
    transform: scale(0.38);
  }
  72% {
    opacity: 0.78;
  }
  100% {
    opacity: 0;
    transform: scale(1.24);
  }
}
@keyframes gho-capture-mark {
  0% {
    opacity: 0;
    transform: translateY(6px) scale(0.82);
  }
  24% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(-8px) scale(1.24);
  }
}
.gho-panel {
  display: grid;
  gap: 10px;
}
.gho-player {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 10px;
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 10px;
  background: linear-gradient(180deg, #fbfcff, #e8f0fb);
}
.gho-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(23, 32, 29, 0.2);
  border-radius: 999px;
  margin-top: 2px;
}
.gho-player strong,
.gho-player span {
  display: block;
}
.gho-player span {
  color: #52625d;
  font-size: 0.84rem;
}
.gho-player dl {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin: 0;
}
.gho-player dl div {
  border: 1px solid rgba(23, 32, 29, 0.1);
  border-radius: 7px;
  padding: 7px;
  background: #ffffff;
}
.gho-player dt {
  color: #52625d;
  font-size: 0.72rem;
}
.gho-player dd {
  margin: 2px 0 0;
  font-weight: 900;
}
@media (max-width: 780px) {
  .gho-layout {
    grid-template-columns: 1fr;
  }
  .gho-setup-grid {
    grid-template-columns: 1fr;
  }
  .gho-panel {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 480px) {
  .gho-status {
    align-items: flex-start;
    flex-direction: column;
  }
  .gho-status p {
    text-align: left;
  }
  .gho-board,
  .gho-exits {
    gap: 4px;
  }
  .gho-setup-direction {
    gap: 4px;
    padding: 6px;
  }
  .gho-panel {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .gho-capture-fx::before,
  .gho-capture-fx::after {
    animation-duration: 1ms;
  }
}
`;
