import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PlayerAvatar, PublicRoomListItem } from "../../shared/types";
import { CafeViewport } from "./CafeViewport";
import type { CafeTablePlacement } from "./CafeTableObject";
import { EntranceCounterSheet } from "./EntranceCounterSheet";
import { PlayerTokenDock } from "./PlayerTokenDock";
import "./interactive-cafe-home.css";
import { playJoinSound } from "../../utils/haptics";

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
  onJoinListedRoom: (code: string) => void | Promise<void>;
  onRefreshRooms: () => void;
  onResumeSavedRoom: () => void | Promise<void>;
  onResetLocalIdentity: () => void;
};

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
  const visibleRooms = rooms.slice(0, 12);
  const emptyTable: CafeTablePlacement = {
    id: "empty-table-primary",
    kind: "empty",
    size: visibleRooms.length === 0 ? "large" : "normal",
    x: 0,
    y: 0,
    scale: 1,
    rotate: 0,
    depth: 0
  };

  const roomTables: CafeTablePlacement[] = visibleRooms.map((room, index) => ({
    id: `table-${room.code}`,
    kind: "room",
    room,
    x: index,
    y: 0,
    scale: 1,
    rotate: 0,
    depth: 0
  }));

  return [...roomTables, emptyTable];
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
  const [joinTransition, setJoinTransition] = useState(false);
  const joinTimerRef = useRef<number | null>(null);
  const joinPendingRef = useRef(false);
  const mountedRef = useRef(false);

  const canCreate = connection === "connected" && Boolean(name.trim());
  const savedRoom = lastRoomCode ? rooms.find((room) => room.code === lastRoomCode) ?? null : null;
  const selectedRoom = selectedRoomCode ? rooms.find((room) => room.code === selectedRoomCode) ?? null : null;
  const activeRoom = selectedRoom ?? savedRoom;
  const tables = useMemo(() => buildCafeTables(rooms), [rooms]);
  const openRoomCount = rooms.filter((room) => room.status === "lobby" && room.canJoin).length;
  const canEnterSelectedRoom = Boolean(
    activeRoom && connection === "connected" && Boolean(name.trim()) && (activeRoom.code === lastRoomCode || (activeRoom.canJoin && activeRoom.status === "lobby"))
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      joinPendingRef.current = false;
      if (joinTimerRef.current !== null) {
        window.clearTimeout(joinTimerRef.current);
        joinTimerRef.current = null;
      }
    };
  }, []);

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

    const tableButton = document
      .elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>(".cafe-table-object"))
      .find((element): element is HTMLElement => Boolean(element));
    if (!tableButton) {
      return false;
    }

    const kind = tableButton.getAttribute("data-table-kind");
    const tableId = tableButton.getAttribute("data-table-id");

    if (kind === "empty") {
      requestCreateTable({ preventDefault: () => undefined });
      return true;
    } else if (kind === "room") {
      const code = tableId?.replace("table-", "");
      const room = code ? rooms.find((item) => item.code === code) : null;
      if (room) {
        handleSelectRoom(room);
        enterRoom(room);
        return true;
      }
    }

    return false;
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
    if (!activeRoom) {
      return;
    }

    enterRoom(activeRoom);
  }

  function enterRoom(room: PublicRoomListItem) {
    const canEnter =
      connection === "connected" &&
      Boolean(name.trim()) &&
      (room.code === lastRoomCode || (room.canJoin && room.status === "lobby"));
    if (!canEnter) {
      return;
    }

    if (joinPendingRef.current) {
      return;
    }

    playJoinSound();
    joinPendingRef.current = true;
    setJoinTransition(true);
    joinTimerRef.current = window.setTimeout(() => {
      joinTimerRef.current = null;
      const action = room.code === lastRoomCode
        ? onResumeSavedRoom
        : () => onJoinListedRoom(room.code);

      void Promise.resolve()
        .then(action)
        .catch(() => undefined)
        .finally(() => {
          joinPendingRef.current = false;
          if (mountedRef.current) {
            setJoinTransition(false);
          }
        });
    }, 360);
  }

  return (
    <section
      className={cx("cafe-home", "is-cafe-home", joinTransition && "is-joining-room")}
      data-connection={connection}
      aria-labelledby="cafe-home-title"
    >
      <header className="cafe-home-bar">
        <div className="cafe-home-title-block">
          <span className="cafe-home-kicker">BOARD GAME CLUB</span>
          <h2 id="cafe-home-title">오늘의 테이블</h2>
          <p>{rooms.length > 0 ? `${rooms.length}개 테이블 · 지금 입장 가능 ${openRoomCount}개` : "첫 테이블을 열어 게임을 시작하세요."}</p>
        </div>
        <div className="cafe-home-metrics" aria-label="테이블 현황">
          <span>
            <strong>{rooms.length.toString().padStart(2, "0")}</strong>
            <small>TABLES</small>
          </span>
          <span>
            <strong>{openRoomCount.toString().padStart(2, "0")}</strong>
            <small>OPEN</small>
          </span>
        </div>
        <div className="cafe-home-status-area">
          <span className="cafe-connection-status" role="status" aria-live="polite">{connectionLabel(connection)}</span>
          <button className="cafe-refresh-button" type="button" onClick={onRefreshRooms} disabled={roomsLoading} aria-label="테이블 새로 보기">
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="cafe-home-stage">
        <div className="cafe-table-ledger">
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
        </div>

        <div className="cafe-counter-rail">
          <PlayerTokenDock
            name={name}
            avatar={avatar}
            canCreate={canCreate}
            hasSavedRoom={Boolean(savedRoom)}
            onNameChange={onNameChange}
            onAvatarChange={onAvatarChange}
            onResumeSavedRoom={onResumeSavedRoom}
            onResetLocalIdentity={onResetLocalIdentity}
            onTokenDrop={handleTokenDrop}
            onDragStateChange={() => undefined}
          />

          <EntranceCounterSheet
            selectedRoom={selectedRoom}
            savedRoom={savedRoom}
            canEnterSelectedRoom={canEnterSelectedRoom}
            roomsLoading={roomsLoading}
            connection={connection}
            onEnterSelectedRoom={enterActiveRoom}
            onRefreshRooms={onRefreshRooms}
            onCloseSelection={() => {
              setSelectedRoomCode("");
              setSelectedTableId("empty-table-primary");
            }}
          />
        </div>
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
