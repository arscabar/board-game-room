import type { FormEvent } from "react";
import type { GameDefinition, PlayerAvatar, PublicRoomListItem, RoomSnapshot } from "../../shared/types";

export type CafePoint = Readonly<{
  x: number;
  y: number;
  z?: number;
}>;

export type CafeSize = Readonly<{
  width: number;
  height: number;
}>;

export type CafeBounds = Readonly<{
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
}>;

export type CafeTableState = "empty" | "open" | "playing" | "full" | "locked" | "creating" | "focused" | "saved";

export type CafeSeatState = "empty" | "occupied" | "host" | "disconnected";

export type CafeTableSeat = Readonly<{
  id: string;
  index: number;
  state: CafeSeatState;
  playerId?: string;
  playerName?: string;
  avatar?: PlayerAvatar | null;
}>;

export type CafeTableNameplate = Readonly<{
  title: string;
  subtitle?: string;
  playerCount?: number;
  maxPlayers?: number;
}>;

export type CafeRoomTable = Readonly<{
  id: string;
  state: CafeTableState;
  position?: CafePoint;
  x?: number;
  y?: number;
  size?: CafeSize;
  rotation?: number;
  scale?: number;
  depth?: number;
  room?: PublicRoomListItem | null;
  roomCode?: string;
  hostName?: string | null;
  hostAvatar?: PlayerAvatar | null;
  playerCount?: number;
  maxPlayers?: number;
  selectedGameId?: string | null;
  selectedGameTitle?: string | null;
  canJoin?: boolean;
  canCreate?: boolean;
  nameplate?: CafeTableNameplate;
  seats?: CafeTableSeat[];
  sourceRoom?: PublicRoomListItem;
}>;

export type CafeHomeProps = Readonly<{
  name: string;
  avatar: PlayerAvatar;
  notice: string;
  connection: "connecting" | "connected" | "offline";
  lastRoomCode: string;
  rooms: PublicRoomListItem[];
  roomsLoading: boolean;
  onNameChange: (value: string) => void;
  onAvatarChange: (value: PlayerAvatar) => void;
  onCreateRoom: (event: FormEvent) => void;
  onJoinListedRoom: (code: string) => void;
  onRefreshRooms: () => void;
  onResumeSavedRoom: () => void;
  onResetLocalIdentity: () => void;
}>;

export type PlayerTokenDockState = "docked" | "lifted" | "dragging" | "over-empty-table" | "creating";

export type GameBoxState =
  | "shelf"
  | "focused"
  | "grabbed"
  | "dragging"
  | "over-table"
  | "opening"
  | "unfolded"
  | "selected"
  | "locked";

export type TableStageState =
  | "empty"
  | "previewing"
  | "ready-to-drop"
  | "box-dropped"
  | "opening"
  | "unfolded"
  | "selected"
  | "game-selected"
  | "locked";

export type PlacementSource = "tap" | "drag" | "keyboard" | "programmatic";

export type GameBoxObject = Readonly<{
  game: GameDefinition;
  state: GameBoxState;
  position?: CafePoint;
  available: boolean;
  selected: boolean;
  accent?: string;
}>;

export type CentralTableStage = Readonly<{
  state: TableStageState;
  selectedGameId: string | null;
  previewGameId?: string | null;
  activeGame?: GameDefinition | null;
  lastPlacement?: PlacementSource;
  dropTargetId?: string | null;
}>;

export type SeatToken = Readonly<{
  playerId: string;
  playerName: string;
  seat: number;
  avatar: PlayerAvatar;
  isHost: boolean;
  connected: boolean;
}>;

export type InteractiveGameLobbyState = Readonly<{
  room: RoomSnapshot;
  stage: CentralTableStage;
  boxes: GameBoxObject[];
  seats: SeatToken[];
}>;

export type DragPhase = "idle" | "pending" | "dragging" | "dropped" | "cancelled";

export type DragInputSource = "mouse" | "touch" | "pen" | "keyboard" | "programmatic";

export type DragState<TItem = unknown, TDropTarget = unknown> = Readonly<{
  phase: DragPhase;
  item: TItem | null;
  pointerId: number | null;
  source: DragInputSource;
  origin: CafePoint;
  current: CafePoint;
  delta: CafePoint;
  hasMoved: boolean;
  dropTarget: TDropTarget | null;
  dropTargetId: string | null;
  startedAt: number | null;
}>;
