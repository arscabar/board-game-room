import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

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
  kind: GhostKind;
  row: number;
  col: number;
  captured: boolean;
  escaped: boolean;
  capturedBy?: string;
}

interface GhostsState {
  players: GhostsPlayer[];
  pieces: GhostPiece[];
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
  winnerId: string | null;
  message: string;
  viewerId: string | null;
}

interface MovePayload {
  pieceId: string;
  to: Coord;
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
    pieces: state.pieces.map((piece) => ({ ...piece }))
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
    kind: kindPattern[index],
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
    throw new Error("Game is already complete.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("It is not your turn.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("Player is not in this Ghosts game.");
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
    throw new Error("Ghost move needs a piece and target square.");
  }

  const payload = action.payload;
  const player = requireActivePlayer(state, context);
  const piece = state.pieces.find((candidate) => candidate.id === payload.pieceId);
  if (!piece || piece.ownerId !== player.id || piece.captured || piece.escaped) {
    throw new Error("Choose one of your active ghosts.");
  }

  const target = payload.to;
  const orthogonalStep = Math.abs(target.row - piece.row) + Math.abs(target.col - piece.col) === 1;
  if (!orthogonalStep) {
    throw new Error("Ghosts move one orthogonal step.");
  }

  const next = cloneState(state);
  const nextPiece = next.pieces.find((candidate) => candidate.id === piece.id);
  if (!nextPiece) {
    throw new Error("Ghost could not be found.");
  }

  if (!inBoard(target.row, target.col)) {
    if (!canEscape(player, nextPiece, target)) {
      throw new Error("Only a good ghost on an opponent corner can escape.");
    }

    nextPiece.escaped = true;
    return finishForWinner(
      next,
      player.id,
      `${player.name} escaped a good ghost through the corner.`,
      `${player.name} wins by escaping a good ghost`
    );
  }

  const occupant = pieceAt(next, target.row, target.col);
  if (occupant?.ownerId === player.id) {
    throw new Error("You cannot move onto your own ghost.");
  }

  let captureText = "";
  if (occupant) {
    occupant.captured = true;
    occupant.capturedBy = player.id;
    captureText = ` and captured a ${occupant.kind} ghost`;
  }

  nextPiece.row = target.row;
  nextPiece.col = target.col;

  if (occupant) {
    const winnerId = winnerAfterCapture(next, player.id, occupant.ownerId, occupant.kind);
    if (winnerId) {
      const winner = next.players.find((candidate) => candidate.id === winnerId);
      const reason =
        winnerId === player.id
          ? "captured all opposing good ghosts"
          : "had all of their bad ghosts captured";
      return finishForWinner(
        next,
        winnerId,
        `${winner?.name ?? "A player"} wins: ${reason}.`,
        `${winner?.name ?? "A player"} wins by ${reason}`
      );
    }
  }

  next.message = `${player.name} moved to ${target.row + 1}-${target.col + 1}${captureText}.`;
  return {
    state: next,
    log: `${player.name} moved a ghost${captureText}`,
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
    winnerId: null,
    message: "Ghosts are ready."
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
      winnerId: ghostsState.winnerId,
      message: ghostsState.message,
      viewerId: context.viewerId
    };
  },
  applyAction: (state, action, context) => {
    const ghostsState = state as GhostsState;
    if (action.type === "moveGhost") {
      return moveGhost(ghostsState, action, context);
    }
    throw new Error("Unknown Ghosts action.");
  }
};

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
  if (kind === "good") return "G";
  if (kind === "bad") return "B";
  return "?";
}

function publicKindName(kind: GhostKind | null) {
  if (kind === "good") return "good";
  if (kind === "bad") return "bad";
  return "unknown";
}

function pieceTitle(piece: PublicGhostPiece, owner: GhostsPlayer | undefined) {
  return `${owner?.name ?? "Player"} ${publicKindName(piece.kind)} ghost`;
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
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const selectedPiece =
    publicState.pieces.find((piece) => piece.id === selectedPieceId && !piece.captured && !piece.escaped) ?? null;
  const canAct =
    !disabled &&
    !publicState.winnerId &&
    Boolean(currentModulePlayer) &&
    currentPlayer?.id === activePlayer?.id;

  const legalTargets = useMemo(() => {
    if (!selectedPiece || !currentModulePlayer || selectedPiece.ownerId !== currentModulePlayer.id) return [];
    return legalTargetsFor(publicState, currentModulePlayer, selectedPiece);
  }, [currentModulePlayer, publicState, selectedPiece]);

  const legalTargetKeys = new Set(legalTargets.map(targetKey));
  const winner = publicState.players.find((player) => player.id === publicState.winnerId);

  function selectOrMove(row: number, col: number) {
    if (!canAct || !currentModulePlayer) return;
    const occupant = getPublicPieceAt(publicState, row, col);
    if (selectedPiece && legalTargetKeys.has(targetKey({ row, col }))) {
      onAction({ type: "moveGhost", payload: { pieceId: selectedPiece.id, to: { row, col } } });
      setSelectedPieceId(null);
      return;
    }
    if (occupant?.ownerId === currentModulePlayer.id) {
      setSelectedPieceId(occupant.id);
    }
  }

  function escapeAt(col: number, side: Side) {
    if (!canAct || !selectedPiece || !currentModulePlayer || currentModulePlayer.side !== side) return;
    const target = { row: exitRowFor(currentModulePlayer), col };
    if (!legalTargetKeys.has(targetKey(target))) return;
    onAction({ type: "moveGhost", payload: { pieceId: selectedPiece.id, to: target } });
    setSelectedPieceId(null);
  }

  return (
    <div className="gho-shell">
      <style>{ghostsStyles}</style>
      <div className="gho-status" aria-live="polite">
        <div>
          <strong>{publicState.winnerId ? "Winner" : "Turn"}</strong>
          <span>{publicState.winnerId ? winner?.name ?? "Complete" : activeModulePlayer?.name ?? "Waiting"}</span>
        </div>
        <p>{publicState.message}</p>
      </div>

      <div className="gho-layout">
        <div className="gho-board-wrap">
          <div className="gho-exits top" aria-label="North escape corners">
            {[0, BOARD_SIZE - 1].map((col) => {
              const legal = Boolean(
                selectedPiece &&
                  currentModulePlayer?.side === "south" &&
                  legalTargetKeys.has(targetKey({ row: -1, col }))
              );
              return (
                <button
                  className={legal ? "legal" : ""}
                  disabled={!legal}
                  key={`north-${col}`}
                  onClick={() => escapeAt(col, "south")}
                  style={{ gridColumn: col + 1 } as CSSProperties}
                  title={`Escape through north corner ${col + 1}`}
                  type="button"
                >
                  Exit
                </button>
              );
            })}
          </div>

          <div className="gho-board" aria-label="Ghosts board">
            {Array.from({ length: BOARD_SIZE }, (_, row) =>
              Array.from({ length: BOARD_SIZE }, (_, col) => {
                const piece = getPublicPieceAt(publicState, row, col);
                const owner = publicState.players.find((player) => player.id === piece?.ownerId);
                const selected = selectedPieceId === piece?.id;
                const legal = legalTargetKeys.has(targetKey({ row, col }));
                const ownPiece = piece?.ownerId === currentModulePlayer?.id;
                return (
                  <button
                    className={`gho-cell ${legal ? "legal" : ""} ${selected ? "selected" : ""}`}
                    disabled={!canAct || (!ownPiece && !legal)}
                    key={targetKey({ row, col })}
                    onClick={() => selectOrMove(row, col)}
                    title={`Row ${row + 1}, column ${col + 1}`}
                    type="button"
                  >
                    {piece ? (
                      <span
                        className={`gho-token ${piece.kind ?? "hidden"} ${ownPiece ? "own" : "opponent"}`}
                        style={{ "--ghost-color": owner?.color ?? "#17201d" } as CSSProperties}
                        title={pieceTitle(piece, owner)}
                      >
                        {kindLabel(piece.kind)}
                      </span>
                    ) : legal ? (
                      <span className="gho-move-dot" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="gho-exits bottom" aria-label="South escape corners">
            {[0, BOARD_SIZE - 1].map((col) => {
              const legal = Boolean(
                selectedPiece &&
                  currentModulePlayer?.side === "north" &&
                  legalTargetKeys.has(targetKey({ row: BOARD_SIZE, col }))
              );
              return (
                <button
                  className={legal ? "legal" : ""}
                  disabled={!legal}
                  key={`south-${col}`}
                  onClick={() => escapeAt(col, "north")}
                  style={{ gridColumn: col + 1 } as CSSProperties}
                  title={`Escape through south corner ${col + 1}`}
                  type="button"
                >
                  Exit
                </button>
              );
            })}
          </div>
        </div>

        <aside className="gho-panel" aria-label="Ghost counts">
          {publicState.players.map((player) => {
            const stats = playerStats(publicState, player.id);
            const isCurrent = player.id === currentPlayer?.id;
            return (
              <div className="gho-player" key={player.id}>
                <span className="gho-swatch" style={{ background: player.color }} />
                <div>
                  <strong>{player.name}</strong>
                  <span>{isCurrent ? "You" : player.side === "south" ? "South" : "North"}</span>
                </div>
                <dl>
                  <div>
                    <dt>Active</dt>
                    <dd>{stats.active}</dd>
                  </div>
                  <div>
                    <dt>Good caught</dt>
                    <dd>{stats.capturedGood}</dd>
                  </div>
                  <div>
                    <dt>Bad caught</dt>
                    <dd>{stats.capturedBad}</dd>
                  </div>
                  {isCurrent ? (
                    <>
                      <div>
                        <dt>Good held</dt>
                        <dd>{stats.knownGood}</dd>
                      </div>
                      <div>
                        <dt>Bad held</dt>
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
  border: 1px solid rgba(23, 32, 29, 0.14);
  border-radius: 8px;
  padding: 12px;
  background: #fbfcfa;
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
  padding: 8px;
  border: 1px solid rgba(23, 32, 29, 0.2);
  border-radius: 8px;
  background:
    linear-gradient(45deg, rgba(109, 91, 208, 0.09), transparent 45%),
    #dfe8e4;
}
.gho-cell {
  display: grid;
  place-items: center;
  min-height: 0;
  aspect-ratio: 1;
  border: 1px solid rgba(23, 32, 29, 0.16);
  border-radius: 7px;
  padding: 0;
  background: #fbfcfa;
  color: #17201d;
}
.gho-cell.legal {
  border-color: #28777c;
  background: #e7f5ef;
}
.gho-cell.selected {
  outline: 3px solid #d69b2d;
  outline-offset: -3px;
}
.gho-token {
  display: grid;
  place-items: center;
  width: 72%;
  aspect-ratio: 1;
  border: 2px solid color-mix(in srgb, var(--ghost-color) 72%, #17201d);
  border-radius: 999px 999px 45% 45%;
  background: color-mix(in srgb, var(--ghost-color) 18%, white);
  color: #17201d;
  font-weight: 900;
}
.gho-token.good {
  background: #e4f4ed;
}
.gho-token.bad {
  background: #faedea;
}
.gho-token.hidden {
  background: #f2f0ff;
}
.gho-token.opponent {
  border-style: dashed;
}
.gho-move-dot {
  width: 28%;
  aspect-ratio: 1;
  border-radius: 999px;
  background: #28777c;
}
.gho-exits button {
  min-height: 36px;
  border: 1px dashed rgba(23, 32, 29, 0.22);
  border-radius: 8px;
  background: #edf2ed;
  color: #52625d;
  font-size: 0.82rem;
  font-weight: 800;
}
.gho-exits button.legal {
  border-color: #28777c;
  background: #17201d;
  color: white;
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
  background: #fbfcfa;
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
  .gho-panel {
    grid-template-columns: 1fr;
  }
}
`;
