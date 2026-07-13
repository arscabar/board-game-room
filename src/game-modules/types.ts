import type { GameDefinition, PlayerSnapshot } from "../shared/types";

export interface GameContext {
  game: GameDefinition;
  players: PlayerSnapshot[];
  activePlayerId: string | null;
  currentPlayerId: string;
  turnNumber: number;
  roundNumber: number;
  rngSeed?: string;
  now?: number;
}

export interface GameAction {
  type: string;
  payload?: unknown;
  actionId?: string;
  expectedRevision?: number;
  scopeId?: string;
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
  winnerIds?: string[];
  interactivePlayerIds?: string[];
  resetTimer?: boolean;
}

export interface GameModule {
  id: string;
  concurrencyMode?: "legacy" | "strict" | "phase-scoped";
  timerMode?: "turn" | "phase";
  getTimerDurationMs?: (state: unknown) => number | null;
  createInitialState: (context: Pick<GameContext, "game" | "players" | "rngSeed" | "now">) => unknown;
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
