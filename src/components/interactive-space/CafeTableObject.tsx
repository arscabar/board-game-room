import { Plus, UsersRound } from "lucide-react";
import { type MouseEvent } from "react";
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

function roomStateLabel(state: ReturnType<typeof roomState>) {
  if (state === "saved") return "복귀 가능";
  if (state === "playing") return "게임 중";
  if (state === "full") return "만석";
  if (state === "open") return "입장 가능";
  return "대기";
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
        data-table-id={table.id}
        data-table-kind="empty"
        disabled={!canCreate}
        onClick={handleCreate}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={canCreate ? "빈 테이블, 새 테이블 만들기 가능" : "빈 테이블, 준비 후 만들기 가능"}
      >
        <span className="cafe-table-visual" aria-hidden="true">
          <span className="cafe-table-top cafe-empty-table-top">
            <span className="cafe-empty-table-inlay" />
            <span className="cafe-empty-plus"><Plus size={22} strokeWidth={2} /></span>
          </span>
          <span className="cafe-empty-seat-map">
            <i data-seat="top" />
            <i data-seat="right" />
            <i data-seat="bottom" />
            <i data-seat="left" />
          </span>
        </span>
        <span className="cafe-table-copy">
          <strong>새 테이블</strong>
          <small>{canCreate ? "게임 방 열기" : "이름을 먼저 입력하세요"}</small>
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
      data-table-id={table.id}
      data-table-kind="room"
      data-room-state={state}
      aria-pressed={isSelected}
      aria-label={`${hostTableName(room)}, ${room.playerCount}명 중 ${room.maxPlayers}명, ${gameLabel}, ${
        canUseRoom ? "입장 가능" : "입장 대기"
      }`}
      onClick={() => onSelectRoom(room)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="cafe-table-visual" aria-hidden="true">
        <span className="cafe-table-top">
          <span className="cafe-table-inlay" />
        </span>
        <span className="cafe-seat-map">
          {seatItems(room).map((seat, idx) => (
            <span
              className={cx("cafe-seat-token", `seat-pos-${idx}`, seat.filled && "cafe-seat-token-filled", seat.host && "cafe-seat-token-host")}
              key={seat.id}
            >
              {seat.host && room.hostAvatar ? <PlayerTokenPawn avatar={room.hostAvatar} /> : null}
            </span>
          ))}
        </span>
      </span>

      <span className="cafe-table-copy">
        <span className="cafe-table-copy-main">
          <strong>{hostTableName(room)}</strong>
          <span className="cafe-table-capacity"><UsersRound size={14} />{room.playerCount}/{room.maxPlayers}</span>
        </span>
        <span className="cafe-table-copy-meta">
          <small>{gameLabel}</small>
          <em>{roomStateLabel(state)}</em>
        </span>
      </span>
    </button>
  );
}

export default CafeTableObject;
