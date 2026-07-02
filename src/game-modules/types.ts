import type { GameDefinition, PlayerSnapshot } from "../shared/types";

export interface GameContext {
  game: GameDefinition;
  players: PlayerSnapshot[];
  activePlayerId: string | null;
  currentPlayerId: string;
  turnNumber: number;
  roundNumber: number;
}

export interface GameAction {
  type: string;
  payload?: unknown;
}

export type GameSystemActionReason = "manual-pass" | "host-timeout" | "auto-timeout";

export interface GameSystemAction {
  type: "system/pass" | "system/timeout";
  reason: GameSystemActionReason;
}

export interface GameActionResult {
  state: unknown;
  log?: string;
  activePlayerId?: string | null;
  turnNumber?: number;
  roundNumber?: number;
  phase?: string;
  message?: string;
  winnerId?: string | null;
}

export interface GameModule {
  id: string;
  createInitialState: (context: Pick<GameContext, "game" | "players">) => unknown;
  getPublicState: (state: unknown, context: GameContext & { viewerId: string | null }) => unknown;
  applyAction: (state: unknown, action: GameAction, context: GameContext) => GameActionResult;
  applySystemAction?: (state: unknown, action: GameSystemAction, context: GameContext) => GameActionResult;
}

export interface GameComponentProps<TPublicState = unknown> {
  game: GameDefinition;
  players: PlayerSnapshot[];
  currentPlayer: PlayerSnapshot | null;
  activePlayer: PlayerSnapshot | null;
  publicState: TPublicState;
  disabled: boolean;
  onAction: (action: GameAction) => void;
}

export function nextPlayerId(players: PlayerSnapshot[], activePlayerId: string | null) {
  const connected = players.filter((player) => player.connected);
  if (connected.length === 0) {
    return null;
  }

  const index = connected.findIndex((player) => player.id === activePlayerId);
  return connected[index === -1 ? 0 : (index + 1) % connected.length].id;
}
