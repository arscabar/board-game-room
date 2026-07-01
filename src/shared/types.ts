export type ScoreState = "점수제" | "승수제" | "점수제 아님";

export type GameTableKind =
  | "duel"
  | "maze"
  | "hex"
  | "hidden"
  | "stack"
  | "deduction"
  | "polyomino"
  | "dice"
  | "rings"
  | "word";

export interface GameDefinition {
  id: string;
  title: string;
  original: string;
  allowedPlayerCounts: number[];
  scoreState: ScoreState;
  priority: "높음" | "중간";
  genre: string;
  board: string;
  docFile: string;
  learnUrl: string;
  accent: string;
  summary: string;
  components: string[];
  setup: string[];
  turnFlow: string[];
  winCondition: string;
  implementation: string[];
  table: {
    kind: GameTableKind;
    primaryMetric: string;
    secondaryMetric: string;
    uiHint: string;
  };
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  isHost: boolean;
  joinedAt: number;
}

export interface MoveEntry {
  id: string;
  time: number;
  playerId: string;
  playerName: string;
  action: string;
}

export interface GameRuntimeState {
  activePlayerId: string | null;
  turnNumber: number;
  roundNumber: number;
  moveLog: MoveEntry[];
  startedAt: number | null;
  phase?: string;
  message?: string;
  publicState?: unknown;
  winnerId?: string | null;
}

export type RoomStatus = "lobby" | "playing";

export interface RoomSnapshot {
  code: string;
  maxPlayers: number;
  players: PlayerSnapshot[];
  selectedGameId: string | null;
  status: RoomStatus;
  gameState: GameRuntimeState;
  createdAt: number;
}

export interface Ack<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
