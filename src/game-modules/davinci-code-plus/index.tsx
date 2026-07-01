import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

type TileColor = "black" | "white" | "red";
type VinciPhase = "guessing" | "decide" | "complete";

interface VinciTile {
  id: string;
  color: TileColor;
  value: number;
  revealed: boolean;
}

interface VinciPlayer {
  id: string;
  name: string;
  seat: number;
  hand: VinciTile[];
  eliminated: boolean;
}

interface VinciState {
  players: VinciPlayer[];
  deck: VinciTile[];
  phase: VinciPhase;
  currentStreak: number;
  winnerId: string | null;
  message: string;
  lastGuess: {
    playerId: string;
    targetPlayerId: string;
    tileIndex: number;
    guess: number;
    correct: boolean;
  } | null;
}

interface PublicVinciTile {
  id: string;
  color: TileColor;
  value: number | null;
  revealed: boolean;
}

interface PublicVinciPlayer {
  id: string;
  name: string;
  seat: number;
  hand: PublicVinciTile[];
  eliminated: boolean;
}

interface VinciPublicState {
  players: PublicVinciPlayer[];
  deckCount: number;
  phase: VinciPhase;
  currentStreak: number;
  winnerId: string | null;
  message: string;
  viewerId: string | null;
  lastGuess: VinciState["lastGuess"];
}

interface GuessPayload {
  targetPlayerId: string;
  tileIndex: number;
  guess: number;
}

const colors: TileColor[] = ["black", "white", "red"];
const colorLabels: Record<TileColor, string> = {
  black: "Black",
  white: "White",
  red: "Red"
};
const colorOrder: Record<TileColor, number> = {
  black: 0,
  white: 1,
  red: 2
};
const tileValues = Array.from({ length: 12 }, (_, index) => index);

function isGuessPayload(value: unknown): value is GuessPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.targetPlayerId === "string" &&
    Number.isInteger(item.tileIndex) &&
    Number.isInteger(item.guess)
  );
}

function createDeck() {
  const deck = colors.flatMap((color) =>
    tileValues.map((value): VinciTile => ({
      id: `${color}-${value}`,
      color,
      value,
      revealed: false
    }))
  );

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

function sortHand(hand: VinciTile[]) {
  return [...hand].sort((a, b) => a.value - b.value || colorOrder[a.color] - colorOrder[b.color]);
}

function initialHandSize(playerCount: number) {
  return playerCount >= 4 ? 3 : 4;
}

function cloneState(state: VinciState): VinciState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hand: player.hand.map((tile) => ({ ...tile }))
    })),
    deck: state.deck.map((tile) => ({ ...tile })),
    lastGuess: state.lastGuess ? { ...state.lastGuess } : null
  };
}

function refreshEliminations(state: VinciState) {
  for (const player of state.players) {
    player.eliminated = player.hand.length > 0 && player.hand.every((tile) => tile.revealed);
  }
}

function livePlayers(state: VinciState, context?: GameContext) {
  if (!context) {
    return state.players.filter((player) => !player.eliminated);
  }
  const connectedIds = new Set(context.players.filter((player) => player.connected).map((player) => player.id));
  return state.players.filter((player) => !player.eliminated && connectedIds.has(player.id));
}

function findWinner(state: VinciState, context?: GameContext) {
  const live = livePlayers(state, context);
  return live.length === 1 ? live[0].id : null;
}

function advanceTurn(state: VinciState, context: GameContext, fromPlayerId: string | null = context.activePlayerId) {
  const order = livePlayers(state, context);
  if (order.length === 0) {
    return { activePlayerId: null, turnNumber: context.turnNumber + 1, roundNumber: context.roundNumber };
  }

  const fromSeat = state.players.find((player) => player.id === fromPlayerId)?.seat ?? -1;
  const nextPlayer = order.find((player) => player.seat > fromSeat) ?? order[0];
  const wrapped = fromSeat !== -1 && nextPlayer.seat <= fromSeat;
  return {
    activePlayerId: nextPlayer.id,
    turnNumber: context.turnNumber + 1,
    roundNumber: context.roundNumber + (wrapped ? 1 : 0)
  };
}

function requireActivePlayer(state: VinciState, context: GameContext) {
  if (state.winnerId || state.phase === "complete") {
    throw new Error("Game is already complete.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("It is not your turn.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("Player is not in this Da Vinci Code game.");
  }
  if (player.eliminated) {
    throw new Error("Eliminated players cannot act.");
  }
  return player;
}

function completeIfWinner(state: VinciState, context: GameContext, logPrefix: string): GameActionResult | null {
  refreshEliminations(state);
  const winnerId = findWinner(state, context);
  if (!winnerId) return null;

  const winner = state.players.find((player) => player.id === winnerId);
  state.winnerId = winnerId;
  state.phase = "complete";
  state.message = `${winner?.name ?? "A player"} is the last player with hidden tiles.`;
  return {
    state,
    log: `${logPrefix}; ${winner?.name ?? "a player"} wins`,
    activePlayerId: null,
    phase: "complete",
    message: state.message,
    winnerId
  };
}

function applyGuess(state: VinciState, action: GameAction, context: GameContext): GameActionResult {
  if (!isGuessPayload(action.payload)) {
    throw new Error("Guess needs target player, tile index, and number.");
  }

  const player = requireActivePlayer(state, context);
  if (state.phase !== "guessing") {
    throw new Error("Choose continue before making another guess.");
  }

  const { targetPlayerId, tileIndex, guess } = action.payload;
  if (guess < 0 || guess > 11) {
    throw new Error("Guess must be a number from 0 to 11.");
  }
  if (targetPlayerId === player.id) {
    throw new Error("Target another player.");
  }

  const next = cloneState(state);
  const nextPlayer = next.players.find((candidate) => candidate.id === player.id);
  const target = next.players.find((candidate) => candidate.id === targetPlayerId);
  if (!nextPlayer || !target || target.eliminated) {
    throw new Error("Target player is not available.");
  }

  const targetTile = target.hand[tileIndex];
  if (!targetTile) {
    throw new Error("Target tile does not exist.");
  }
  if (targetTile.revealed) {
    throw new Error("That tile is already revealed.");
  }

  const correct = targetTile.value === guess;
  next.lastGuess = {
    playerId: player.id,
    targetPlayerId,
    tileIndex,
    guess,
    correct
  };

  if (correct) {
    targetTile.revealed = true;
    refreshEliminations(next);
    const logPrefix = `${player.name} correctly guessed ${target.name}'s tile ${tileIndex + 1}`;
    const complete = completeIfWinner(next, context, logPrefix);
    if (complete) return complete;

    next.phase = "decide";
    next.currentStreak += 1;
    next.message = `${player.name} revealed ${target.name}'s ${colorLabels[targetTile.color]} tile.`;
    return {
      state: next,
      log: logPrefix,
      activePlayerId: player.id,
      phase: "decide",
      message: next.message,
      winnerId: null
    };
  }

  const penaltyTile = nextPlayer.hand.find((tile) => !tile.revealed);
  if (penaltyTile) {
    penaltyTile.revealed = true;
  }
  refreshEliminations(next);
  const logPrefix = `${player.name} missed a guess`;
  const complete = completeIfWinner(next, context, logPrefix);
  if (complete) return complete;

  next.phase = "guessing";
  next.currentStreak = 0;
  next.message = penaltyTile
    ? `${player.name} missed and revealed one own tile.`
    : `${player.name} missed with no hidden tile to reveal.`;
  return {
    state: next,
    log: logPrefix,
    phase: "guessing",
    message: next.message,
    winnerId: null,
    ...advanceTurn(next, context, player.id)
  };
}

function continueGuessing(state: VinciState, context: GameContext): GameActionResult {
  const player = requireActivePlayer(state, context);
  if (state.phase !== "decide") {
    throw new Error("There is no correct guess to continue from.");
  }

  const next = cloneState(state);
  next.phase = "guessing";
  next.message = `${player.name} continues guessing.`;
  return {
    state: next,
    log: `${player.name} continues guessing`,
    activePlayerId: player.id,
    phase: "guessing",
    message: next.message,
    winnerId: null
  };
}

function passTurn(state: VinciState, context: GameContext): GameActionResult {
  const player = requireActivePlayer(state, context);
  if (state.phase !== "decide") {
    throw new Error("End the turn after a correct guess.");
  }

  const next = cloneState(state);
  next.phase = "guessing";
  next.currentStreak = 0;
  next.message = `${player.name} ended the turn.`;
  return {
    state: next,
    log: `${player.name} ends the turn`,
    phase: "guessing",
    message: next.message,
    winnerId: null,
    ...advanceTurn(next, context, player.id)
  };
}

function createInitialState(context: Pick<GameContext, "game" | "players">): VinciState {
  const seatedPlayers = context.players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 4);
  const deck = createDeck();
  const handSize = initialHandSize(seatedPlayers.length);

  const players = seatedPlayers.map((player): VinciPlayer => {
    const hand = sortHand(deck.splice(0, handSize));
    return {
      id: player.id,
      name: player.name,
      seat: player.seat,
      hand,
      eliminated: false
    };
  });

  return {
    players,
    deck,
    phase: "guessing",
    currentStreak: 0,
    winnerId: null,
    message: "Racks are set.",
    lastGuess: null
  };
}

export const module: GameModule = {
  id: "davinci-code-plus",
  createInitialState,
  getPublicState: (state, context): VinciPublicState => {
    const vinciState = state as VinciState;
    return {
      players: vinciState.players.map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        eliminated: player.eliminated,
        hand: player.hand.map((tile) => ({
          id: tile.id,
          color: tile.color,
          value: tile.revealed || player.id === context.viewerId ? tile.value : null,
          revealed: tile.revealed
        }))
      })),
      deckCount: vinciState.deck.length,
      phase: vinciState.phase,
      currentStreak: vinciState.currentStreak,
      winnerId: vinciState.winnerId,
      message: vinciState.message,
      viewerId: context.viewerId,
      lastGuess: vinciState.lastGuess ? { ...vinciState.lastGuess } : null
    };
  },
  applyAction: (state, action, context) => {
    const vinciState = state as VinciState;
    if (action.type === "guess") {
      return applyGuess(vinciState, action, context);
    }
    if (action.type === "continue") {
      return continueGuessing(vinciState, context);
    }
    if (action.type === "pass") {
      return passTurn(vinciState, context);
    }
    throw new Error("Unknown Da Vinci Code action.");
  }
};

function tileText(tile: PublicVinciTile, ownerId: string, viewerId: string | null) {
  if (tile.value !== null) return String(tile.value);
  if (ownerId === viewerId) return "?";
  return "?";
}

function hiddenTileIndices(player: PublicVinciPlayer | undefined) {
  if (!player || player.eliminated) return [];
  return player.hand.map((tile, index) => ({ tile, index })).filter(({ tile }) => !tile.revealed).map(({ index }) => index);
}

function colorStyle(color: TileColor): CSSProperties {
  if (color === "black") return { "--tile-bg": "#171a1f", "--tile-fg": "#ffffff" } as CSSProperties;
  if (color === "red") return { "--tile-bg": "#b94f45", "--tile-fg": "#ffffff" } as CSSProperties;
  return { "--tile-bg": "#f8fafc", "--tile-fg": "#17201d" } as CSSProperties;
}

export function Component(props: GameComponentProps) {
  const { activePlayer, currentPlayer, disabled, onAction } = props;
  const publicState = props.publicState as VinciPublicState;
  const [targetPlayerId, setTargetPlayerId] = useState("");
  const [tileIndex, setTileIndex] = useState(0);
  const [guess, setGuess] = useState(0);
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const targets = useMemo(
    () => publicState.players.filter((player) => player.id !== currentPlayer?.id && !player.eliminated),
    [currentPlayer?.id, publicState.players]
  );
  const effectiveTargetId = targets.some((player) => player.id === targetPlayerId)
    ? targetPlayerId
    : targets[0]?.id ?? "";
  const target = publicState.players.find((player) => player.id === effectiveTargetId);
  const targetHiddenIndices = hiddenTileIndices(target);
  const effectiveTileIndex = targetHiddenIndices.includes(tileIndex) ? tileIndex : targetHiddenIndices[0] ?? 0;
  const winner = publicState.players.find((player) => player.id === publicState.winnerId);
  const canAct =
    !disabled &&
    !publicState.winnerId &&
    currentModulePlayer?.id === activeModulePlayer?.id &&
    publicState.phase !== "complete";
  const canGuess =
    canAct &&
    publicState.phase === "guessing" &&
    Boolean(effectiveTargetId) &&
    targetHiddenIndices.includes(effectiveTileIndex);
  const canDecide = canAct && publicState.phase === "decide";

  function sendGuess() {
    if (!canGuess) return;
    onAction({
      type: "guess",
      payload: {
        targetPlayerId: effectiveTargetId,
        tileIndex: effectiveTileIndex,
        guess
      }
    });
  }

  return (
    <div className="dvc-shell">
      <style>{davinciStyles}</style>
      <div className="dvc-status" aria-live="polite">
        <div>
          <strong>{publicState.winnerId ? "Winner" : "Turn"}</strong>
          <span>{publicState.winnerId ? winner?.name ?? "Complete" : activeModulePlayer?.name ?? "Waiting"}</span>
        </div>
        <div className="dvc-metrics">
          <span>Deck {publicState.deckCount}</span>
          <span>Streak {publicState.currentStreak}</span>
        </div>
        <p>{publicState.message}</p>
      </div>

      <div className="dvc-layout">
        <div className="dvc-racks" aria-label="Player racks">
          {publicState.players.map((player) => {
            const isViewer = player.id === currentPlayer?.id;
            const isActive = player.id === activePlayer?.id;
            return (
              <section className={`dvc-player ${player.eliminated ? "eliminated" : ""}`} key={player.id}>
                <div className="dvc-player-head">
                  <div>
                    <strong>{player.name}</strong>
                    <span>{isViewer ? "You" : isActive ? "Active" : `Seat ${player.seat}`}</span>
                  </div>
                  <span className={player.eliminated ? "dvc-badge out" : "dvc-badge"}>
                    {player.eliminated ? "Out" : `${hiddenTileIndices(player).length} hidden`}
                  </span>
                </div>
                <div className="dvc-hand">
                  {player.hand.map((tile, index) => {
                    const selectable =
                      canGuess && player.id === effectiveTargetId && !tile.revealed && player.id !== currentPlayer?.id;
                    return (
                      <button
                        className={`dvc-tile ${tile.revealed ? "revealed" : ""} ${isViewer && !tile.revealed ? "private" : ""} ${selectable && index === effectiveTileIndex ? "selected" : ""}`}
                        disabled={!selectable}
                        key={tile.id}
                        onClick={() => {
                          setTargetPlayerId(player.id);
                          setTileIndex(index);
                        }}
                        style={colorStyle(tile.color)}
                        title={`${colorLabels[tile.color]} tile ${index + 1}`}
                        type="button"
                      >
                        <span>{tileText(tile, player.id, publicState.viewerId)}</span>
                        <small>{index + 1}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="dvc-panel" aria-label="Guess controls">
          <label htmlFor="dvc-target">Target</label>
          <select
            disabled={!canAct || targets.length === 0}
            id="dvc-target"
            onChange={(event) => {
              setTargetPlayerId(event.currentTarget.value);
              setTileIndex(0);
            }}
            value={effectiveTargetId}
          >
            {targets.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>

          <label htmlFor="dvc-tile">Tile index</label>
          <select
            disabled={!canAct || targetHiddenIndices.length === 0}
            id="dvc-tile"
            onChange={(event) => setTileIndex(Number(event.currentTarget.value))}
            value={effectiveTileIndex}
          >
            {targetHiddenIndices.map((index) => (
              <option key={index} value={index}>
                {index + 1}
              </option>
            ))}
          </select>

          <label htmlFor="dvc-guess">Guess</label>
          <select
            disabled={!canAct}
            id="dvc-guess"
            onChange={(event) => setGuess(Number(event.currentTarget.value))}
            value={guess}
          >
            {tileValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <button className="dvc-action" disabled={!canGuess} onClick={sendGuess} type="button">
            Guess number
          </button>

          <div className="dvc-decision">
            <button disabled={!canDecide} onClick={() => onAction({ type: "continue" })} type="button">
              Continue
            </button>
            <button disabled={!canDecide} onClick={() => onAction({ type: "pass" })} type="button">
              End turn
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

const davinciStyles = `
.dvc-shell {
  display: grid;
  gap: 14px;
  color: #17201d;
}
.dvc-status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.4fr);
  gap: 12px;
  align-items: center;
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  padding: 12px;
  background:
    linear-gradient(180deg, #fff9ef, #ead9c1);
}
.dvc-status strong,
.dvc-status span {
  display: block;
}
.dvc-status span,
.dvc-status p {
  color: #52625d;
}
.dvc-status p {
  margin: 0;
  text-align: right;
}
.dvc-metrics {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: center;
}
.dvc-metrics span,
.dvc-badge {
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  padding: 6px 8px;
  background: #f6e6cd;
  color: #52625d;
  font-size: 0.8rem;
  font-weight: 800;
}
.dvc-badge.out {
  color: #8f2c25;
  background: #faedea;
}
.dvc-layout {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 230px;
  gap: 16px;
  align-items: start;
}
.dvc-racks {
  display: grid;
  gap: 10px;
}
.dvc-player {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  padding: 11px;
  background:
    linear-gradient(180deg, rgba(255, 250, 240, 0.95), rgba(229, 206, 174, 0.82));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
.dvc-player.eliminated {
  opacity: 0.62;
}
.dvc-player-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.dvc-player-head strong,
.dvc-player-head span {
  display: block;
}
.dvc-player-head span {
  color: #52625d;
  font-size: 0.84rem;
}
.dvc-hand {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  align-items: end;
  border: 1px solid rgba(69, 40, 31, 0.18);
  border-radius: 8px;
  padding: 9px 9px 7px;
  background:
    linear-gradient(180deg, transparent 0 calc(100% - 9px), rgba(69, 40, 31, 0.42) calc(100% - 9px)),
    rgba(255, 255, 255, 0.45);
}
.dvc-tile {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  place-items: center;
  width: 48px;
  height: 68px;
  border: 2px solid rgba(23, 32, 29, 0.28);
  border-radius: 6px;
  padding: 5px;
  background:
    radial-gradient(circle at 28% 18%, rgba(255, 255, 255, 0.26), transparent 23%),
    var(--tile-bg);
  color: var(--tile-fg);
  box-shadow:
    inset 0 -6px 9px rgba(0, 0, 0, 0.16),
    0 5px 7px rgba(52, 31, 22, 0.22);
}
.dvc-tile span {
  font-size: 1.35rem;
  font-weight: 900;
  line-height: 1;
}
.dvc-tile small {
  opacity: 0.72;
  font-size: 0.7rem;
}
.dvc-tile.private {
  box-shadow:
    inset 0 0 0 2px #d69b2d,
    inset 0 -6px 9px rgba(0, 0, 0, 0.16),
    0 5px 7px rgba(52, 31, 22, 0.22);
}
.dvc-tile.revealed {
  transform: translateY(-2px);
  box-shadow:
    inset 0 -6px 9px rgba(0, 0, 0, 0.16),
    0 8px 14px rgba(23, 32, 29, 0.18);
}
.dvc-tile.selected {
  outline: 3px solid #28777c;
  outline-offset: 2px;
}
.dvc-panel {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  padding: 10px;
  background: linear-gradient(180deg, #fffaf0, #ead9c1);
}
.dvc-panel select {
  width: 100%;
  min-height: 44px;
  border: 1px solid rgba(23, 32, 29, 0.22);
  border-radius: 8px;
  padding: 0 10px;
  background: white;
  color: #17201d;
  font: inherit;
}
.dvc-action,
.dvc-decision button {
  border: 1px solid rgba(99, 57, 51, 0.18);
  border-radius: 8px;
  background: linear-gradient(180deg, #fff5df, #dcb878);
  color: #17201d;
  font-weight: 800;
}
.dvc-action {
  margin-top: 4px;
  background: linear-gradient(180deg, #773c36, #2c2022);
  color: white;
}
.dvc-decision {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}
@media (max-width: 780px) {
  .dvc-layout,
  .dvc-status {
    grid-template-columns: 1fr;
  }
  .dvc-status p,
  .dvc-metrics {
    text-align: left;
    justify-content: flex-start;
  }
}
@media (max-width: 440px) {
  .dvc-player-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .dvc-tile {
    width: 44px;
    height: 64px;
  }
}
`;
