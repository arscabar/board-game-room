import { Plus } from "lucide-react";
import { type CSSProperties, type MouseEvent } from "react";
import type { PublicRoomListItem } from "../../shared/types";
import { PlayerTokenPawn } from "./PlayerTokenDock";

type PreventableEvent = {
  preventDefault: () => void;
};

export type CafeTablePlacement = {
  id: string;
  kind: "empty" | "room";
  room?: PublicRoomListItem;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  depth: number;
  size?: "normal" | "large";
};

export type CafeTableObjectProps = {
  table: CafeTablePlacement;
  canCreate: boolean;
  canUseRoom: boolean;
  isSelected: boolean;
  isSavedRoom: boolean;
  createState: "idle" | "placing";
  onCreateTable: (event: PreventableEvent) => void;
  onSelectRoom: (room: PublicRoomListItem) => void;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function hostTableName(room: PublicRoomListItem) {
  const host = room.hostName?.trim() || "손님";
  return `${host}의 테이블`;
}

function tableGameLabel(room: PublicRoomListItem) {
  if (room.status === "playing") {
    return room.selectedGameTitle ?? "진행 중";
  }

  return room.selectedGameTitle ?? "게임 선택 전";
}

function roomState(room: PublicRoomListItem, canUseRoom: boolean, isSavedRoom: boolean) {
  if (isSavedRoom) {
    return "saved";
  }
  if (room.status === "playing") {
    return "playing";
  }
  if (!room.canJoin && room.playerCount >= room.maxPlayers) {
    return "full";
  }
  return canUseRoom ? "open" : "waiting";
}

function placementStyle(table: CafeTablePlacement) {
  return {
    "--cafe-table-x": `${table.x}%`,
    "--cafe-table-y": `${table.y}%`,
    "--cafe-table-scale": table.scale,
    "--cafe-table-rotate": `${table.rotate}deg`,
    "--cafe-table-depth": table.depth
  } as CSSProperties;
}

function seatItems(room: PublicRoomListItem) {
  const totalSeats = Math.max(2, Math.min(room.maxPlayers || 4, 4));
  return Array.from({ length: totalSeats }, (_, index) => ({
    id: index,
    filled: index < room.playerCount,
    host: index === 0 && Boolean(room.hostAvatar)
  }));
}

export function CafeTableObject({
  table,
  canCreate,
  canUseRoom,
  isSelected,
  isSavedRoom,
  createState,
  onCreateTable,
  onSelectRoom
}: CafeTableObjectProps) {
  if (table.kind === "empty") {
    function handleCreate(event: MouseEvent<HTMLButtonElement>) {
      onCreateTable(event);
    }

    return (
      <button
        className={cx(
          "cafe-table-object",
          "empty-table-object",
          table.size === "large" && "cafe-table-object-large",
          isSelected && "cafe-table-object-selected",
          createState === "placing" && "cafe-table-object-placing"
        )}
        type="button"
        style={placementStyle(table)}
        data-table-id={table.id}
        data-table-kind="empty"
        disabled={!canCreate}
        onClick={handleCreate}
        aria-label={canCreate ? "빈 테이블, 새 테이블 만들기 가능" : "빈 테이블, 준비 후 만들기 가능"}
      >
        <span className="cafe-table-chair cafe-table-chair-top" aria-hidden="true" />
        <span className="cafe-table-chair cafe-table-chair-right" aria-hidden="true" />
        <span className="cafe-table-chair cafe-table-chair-bottom" aria-hidden="true" />
        <span className="cafe-table-chair cafe-table-chair-left" aria-hidden="true" />
        <span className="cafe-table-surface" aria-hidden="true">
          <span className="cafe-table-inner-rim" />
          <span className="cafe-empty-plus">
            <Plus size={30} strokeWidth={2.4} aria-hidden="true" />
          </span>
        </span>
        <span className="cafe-empty-nameplate">
          <strong>빈 테이블</strong>
          <small>테이블 만들기</small>
        </span>
      </button>
    );
  }

  const room = table.room;
  if (!room) {
    return null;
  }

  const state = roomState(room, canUseRoom, isSavedRoom);
  const gameLabel = tableGameLabel(room);

  return (
    <button
      className={cx(
        "cafe-table-object",
        "occupied-table-object",
        `cafe-table-object-${state}`,
        isSelected && "cafe-table-object-selected",
        table.size === "large" && "cafe-table-object-large"
      )}
      type="button"
      style={placementStyle(table)}
      data-table-id={table.id}
      data-table-kind="room"
      data-room-state={state}
      aria-pressed={isSelected}
      aria-label={`${hostTableName(room)}, ${room.playerCount}명 중 ${room.maxPlayers}명, ${gameLabel}, ${
        canUseRoom ? "입장 가능" : "입장 대기"
      }`}
      onClick={() => onSelectRoom(room)}
    >
      <span className="cafe-table-chair cafe-table-chair-top" aria-hidden="true" />
      <span className="cafe-table-chair cafe-table-chair-right" aria-hidden="true" />
      <span className="cafe-table-chair cafe-table-chair-bottom" aria-hidden="true" />
      <span className="cafe-table-chair cafe-table-chair-left" aria-hidden="true" />

      <span className="cafe-table-surface" aria-hidden="true">
        <span className="cafe-table-inner-rim" />
        <span className="cafe-seat-map">
          {seatItems(room).map((seat) => (
            <span
              className={cx("cafe-seat-token", seat.filled && "cafe-seat-token-filled", seat.host && "cafe-seat-token-host")}
              key={seat.id}
            >
              {seat.host && room.hostAvatar ? <PlayerTokenPawn avatar={room.hostAvatar} /> : null}
            </span>
          ))}
        </span>
        {room.status === "playing" ? <span className="cafe-game-box-shadow" /> : null}
      </span>

      <span className="cafe-table-nameplate">
        <strong>{hostTableName(room)}</strong>
        <span>{room.playerCount}/{room.maxPlayers}</span>
        <small>{gameLabel}</small>
      </span>
    </button>
  );
}

export default CafeTableObject;
