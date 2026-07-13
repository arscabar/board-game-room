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
  visual?: {
    iconKind?: GameTableKind;
    thumbnailHint?: string;
    motionHint?: string;
    texture?: "wood" | "felt" | "paper" | "tile" | "card" | "dice" | "stone";
  };
  interaction?: {
    mode: "turn" | "simultaneous";
    openPhases?: string[];
  };
  timer?: {
    fixedLabel: string;
  };
}

export type PlayerAvatarBody = "pawn" | "round" | "bot" | "crest";
export type PlayerAvatarFace = "smile" | "focus" | "wink" | "calm";
export type PlayerAvatarAccessory = "none" | "crown" | "glasses" | "cap" | "spark";
export type PlayerAvatarPalette = "teal" | "amber" | "blue" | "rose" | "violet" | "ivory";

export interface PlayerAvatar {
  body: PlayerAvatarBody;
  face: PlayerAvatarFace;
  accessory: PlayerAvatarAccessory;
  palette: PlayerAvatarPalette;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  isHost: boolean;
  joinedAt: number;
  avatar: PlayerAvatar;
}

export interface MoveEntry {
  id: string;
  time: number;
  playerId: string;
  playerName: string;
  action: string;
}

export type PostGameChoice = "rematch" | "game-select" | "leave-room";

export interface GameRuntimeState {
  activePlayerId: string | null;
  revision: number;
  turnNumber: number;
  roundNumber: number;
  moveLog: MoveEntry[];
  startedAt: number | null;
  turnStartedAt?: number | null;
  turnDeadlineAt?: number | null;
  turnTimerMs?: number;
  paused?: boolean;
  pausedAt?: number | null;
  pausedBy?: string | null;
  totalPausedMs?: number;
  timeoutCounts?: Record<string, number>;
  lastTimeoutAt?: number | null;
  phase?: string;
  message?: string;
  publicState?: unknown;
  winnerId?: string | null;
  winnerIds?: string[];
  postGameChoices?: Record<string, PostGameChoice>;
  postGameNotice?: string | null;
  interactivePlayerIds?: string[];
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
  canDeleteRoom: boolean;
}

export interface PublicRoomListItem {
  code: string;
  playerCount: number;
  maxPlayers: number;
  status: RoomStatus;
  selectedGameId: string | null;
  selectedGameTitle: string | null;
  hostName: string | null;
  hostAvatar: PlayerAvatar | null;
  createdAt: number;
  canJoin: boolean;
}

export interface Ack<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
