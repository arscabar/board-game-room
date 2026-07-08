import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { PlayerAvatar, PublicRoomListItem } from "../../shared/types";
import { CafeViewport } from "./CafeViewport";
import type { CafeTablePlacement } from "./CafeTableObject";
import { EntranceCounterSheet } from "./EntranceCounterSheet";
import { PlayerTokenDock } from "./PlayerTokenDock";
import "./interactive-cafe-home.css";

type PreventableEvent = {
  preventDefault: () => void;
};

export type InteractiveCafeHomeProps = {
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
};

const roomTablePositions = [
  { x: 19, y: 28, scale: 0.94, rotate: -6, depth: 2 },
  { x: 48, y: 22, scale: 1.05, rotate: 3, depth: 5 },
  { x: 75, y: 32, scale: 0.91, rotate: 7, depth: 3 },
  { x: 27, y: 65, scale: 1, rotate: 5, depth: 7 },
  { x: 58, y: 62, scale: 0.96, rotate: -4, depth: 8 },
  { x: 83, y: 69, scale: 0.88, rotate: 2, depth: 6 },
  { x: 10, y: 76, scale: 0.82, rotate: 3, depth: 4 },
  { x: 65, y: 40, scale: 0.84, rotate: -8, depth: 1 }
] satisfies Array<{ x: number; y: number; scale: number; rotate: number; depth: number }>;

const emptyTableWithRooms = { x: 42, y: 46, scale: 1.08, rotate: -2, depth: 9 };
const emptyTableAlone = { x: 48, y: 48, scale: 1.34, rotate: -2, depth: 9 };

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function connectionLabel(connection: InteractiveCafeHomeProps["connection"]) {
  if (connection === "connecting") {
    return "입구 확인 중";
  }
  if (connection === "offline") {
    return "오프라인";
  }
  return "입장 준비";
}

function buildCafeTables(rooms: PublicRoomListItem[]) {
  const visibleRooms = rooms.slice(0, roomTablePositions.length);
  const hasRooms = visibleRooms.length > 0;
  const emptyPlacement = hasRooms ? emptyTableWithRooms : emptyTableAlone;
  const emptyTable: CafeTablePlacement = {
    id: "empty-table-primary",
    kind: "empty",
    size: hasRooms ? "normal" : "large",
    ...emptyPlacement
  };

  const roomTables: CafeTablePlacement[] = visibleRooms.map((room, index) => ({
    id: `table-${room.code}`,
    kind: "room",
    room,
    ...roomTablePositions[index]
  }));

  return hasRooms ? [...roomTables, emptyTable] : [emptyTable];
}

export function InteractiveCafeHome({
  name,
  avatar,
  notice,
  connection,
  lastRoomCode,
  rooms,
  roomsLoading,
  onNameChange,
  onAvatarChange,
  onCreateRoom,
  onJoinListedRoom,
  onRefreshRooms,
  onResumeSavedRoom,
  onResetLocalIdentity
}: InteractiveCafeHomeProps) {
  const [selectedTableId, setSelectedTableId] = useState("empty-table-primary");
  const [selectedRoomCode, setSelectedRoomCode] = useState("");
  const [createState, setCreateState] = useState<"idle" | "placing">("idle");
  const [sceneTilt, setSceneTilt] = useState({ x: 0, y: 0 });

  const canCreate = connection === "connected" && Boolean(name.trim());
  const savedRoom = lastRoomCode ? rooms.find((room) => room.code === lastRoomCode) ?? null : null;
  const selectedRoom = selectedRoomCode ? rooms.find((room) => room.code === selectedRoomCode) ?? null : null;
  const activeRoom = selectedRoom ?? savedRoom;
  const tables = useMemo(() => buildCafeTables(rooms), [rooms]);
  const canEnterSelectedRoom = Boolean(
    activeRoom && connection === "connected" && Boolean(name.trim()) && (activeRoom.code === lastRoomCode || (activeRoom.canJoin && activeRoom.status === "lobby"))
  );

  useEffect(() => {
    if (!selectedRoomCode) {
      return;
    }

    if (!rooms.some((room) => room.code === selectedRoomCode)) {
      setSelectedRoomCode("");
      setSelectedTableId(savedRoom ? `table-${savedRoom.code}` : "empty-table-primary");
    }
  }, [rooms, savedRoom, selectedRoomCode]);

  function requestCreateTable(event: PreventableEvent) {
    event.preventDefault();
    if (!canCreate) {
      return;
    }

    setSelectedRoomCode("");
    setSelectedTableId("empty-table-primary");
    setCreateState("placing");
    onCreateRoom(event as unknown as FormEvent);
    window.setTimeout(() => setCreateState("idle"), 320);
  }

  function handleTokenDrop(clientX: number, clientY: number) {
    if (typeof document === "undefined" || !canCreate) {
      return false;
    }

    const table = document.elementFromPoint(clientX, clientY)?.closest(".empty-table-object");
    if (!table) {
      return false;
    }

    requestCreateTable({ preventDefault: () => undefined });
    return true;
  }

  function handleSelectRoom(room: PublicRoomListItem) {
    setSelectedRoomCode(room.code);
    setSelectedTableId(`table-${room.code}`);
  }

  function handleSelectTable(tableId: string) {
    setSelectedTableId(tableId);
    if (tableId === "empty-table-primary") {
      setSelectedRoomCode("");
    }
  }

  function enterActiveRoom() {
    if (!activeRoom || !canEnterSelectedRoom) {
      return;
    }

    if (activeRoom.code === lastRoomCode) {
      onResumeSavedRoom();
      return;
    }

    onJoinListedRoom(activeRoom.code);
  }

  function handleScenePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setSceneTilt({
      x: Number(((event.clientX - rect.left) / rect.width - 0.5).toFixed(3)),
      y: Number(((event.clientY - rect.top) / rect.height - 0.5).toFixed(3))
    });
  }

  return (
    <section
      className="cafe-home is-cafe-home"
      data-connection={connection}
      aria-labelledby="cafe-home-title"
      onPointerMove={handleScenePointerMove}
      onPointerLeave={() => setSceneTilt({ x: 0, y: 0 })}
      style={
        {
          "--cafe-scene-x": sceneTilt.x,
          "--cafe-scene-y": sceneTilt.y
        } as CSSProperties
      }
    >
      <header className="cafe-home-bar">
        <div className="cafe-home-title-block">
          <span className="cafe-home-kicker">Board Game Cafe</span>
          <h1 id="cafe-home-title">테이블</h1>
        </div>
        <div className="cafe-home-status-area">
          <span className={cx("cafe-connection-chip", connection === "connected" && "cafe-connection-chip-ready")}>
            <i aria-hidden="true" />
            {connectionLabel(connection)}
          </span>
          <button className="cafe-refresh-button" type="button" onClick={onRefreshRooms} disabled={roomsLoading} aria-label="테이블 새로 보기">
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="cafe-home-stage">
        <CafeViewport
          tables={tables}
          selectedTableId={selectedTableId}
          canCreate={canCreate}
          roomsLoading={roomsLoading}
          lastRoomCode={lastRoomCode}
          createState={createState}
          connectionState={connection}
          onCreateTable={requestCreateTable}
          onSelectTable={handleSelectTable}
          onSelectRoom={handleSelectRoom}
        />

        <PlayerTokenDock
          name={name}
          avatar={avatar}
          canCreate={canCreate}
          hasSavedRoom={Boolean(savedRoom)}
          onNameChange={onNameChange}
          onAvatarChange={onAvatarChange}
          onCreateTable={requestCreateTable}
          onResumeSavedRoom={onResumeSavedRoom}
          onResetLocalIdentity={onResetLocalIdentity}
          onTokenDrop={handleTokenDrop}
        />

        <EntranceCounterSheet
          selectedRoom={selectedRoom}
          savedRoom={savedRoom}
          canCreate={canCreate}
          canEnterSelectedRoom={canEnterSelectedRoom}
          roomsLoading={roomsLoading}
          connection={connection}
          onCreateTable={requestCreateTable}
          onEnterSelectedRoom={enterActiveRoom}
          onRefreshRooms={onRefreshRooms}
          onCloseSelection={() => {
            setSelectedRoomCode("");
            setSelectedTableId("empty-table-primary");
          }}
        />
      </div>

      {notice ? (
        <p className="cafe-notice" role="alert">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

export default InteractiveCafeHome;
