import { DoorOpen, RefreshCw, X } from "lucide-react";
import type { PublicRoomListItem } from "../../shared/types";

export type EntranceCounterSheetProps = {
  selectedRoom: PublicRoomListItem | null;
  savedRoom: PublicRoomListItem | null;
  canEnterSelectedRoom: boolean;
  roomsLoading: boolean;
  connection: "connecting" | "connected" | "offline";
  onEnterSelectedRoom: () => void;
  onRefreshRooms: () => void;
  onCloseSelection: () => void;
};

function hostTableName(room: PublicRoomListItem) {
  return `${room.hostName?.trim() || "손님"}의 테이블`;
}

function gameLabel(room: PublicRoomListItem) {
  if (room.status === "playing") {
    return room.selectedGameTitle ?? "진행 중";
  }

  return room.selectedGameTitle ?? "게임 선택 전";
}

function actionLabel(room: PublicRoomListItem, savedRoom: PublicRoomListItem | null) {
  if (savedRoom?.code === room.code) {
    return "복귀";
  }
  if (room.status === "playing") {
    return "진행 중";
  }
  if (!room.canJoin) {
    return "만석";
  }
  return "입장";
}

function connectionLabel(connection: EntranceCounterSheetProps["connection"]) {
  if (connection === "connecting") {
    return "입구 확인 중";
  }
  if (connection === "offline") {
    return "오프라인";
  }
  return "입장 준비";
}

export function EntranceCounterSheet({
  selectedRoom,
  savedRoom,
  canEnterSelectedRoom,
  roomsLoading,
  connection,
  onEnterSelectedRoom,
  onRefreshRooms,
  onCloseSelection
}: EntranceCounterSheetProps) {
  const activeRoom = selectedRoom ?? savedRoom;

  if (!activeRoom) {
    return null;
  }

  return (
    <aside className="entrance-counter-sheet" data-state="table-selected" aria-label="선택한 테이블">
      <header className="entrance-counter-header">
        <span>{connectionLabel(connection)}</span>
        <div className="entrance-counter-actions">
          <button className="entrance-icon-button" type="button" onClick={onRefreshRooms} disabled={roomsLoading} aria-label="테이블 새로 보기">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          {selectedRoom ? (
            <button className="entrance-icon-button" type="button" onClick={onCloseSelection} aria-label="선택 닫기">
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="entrance-table-summary">
        <strong>{hostTableName(activeRoom)}</strong>
        <span>{activeRoom.playerCount}/{activeRoom.maxPlayers}</span>
        <small>{gameLabel(activeRoom)}</small>
      </div>

      <button className="entrance-primary-button" type="button" onClick={onEnterSelectedRoom} disabled={!canEnterSelectedRoom}>
        <DoorOpen size={16} aria-hidden="true" />
        {actionLabel(activeRoom, savedRoom)}
      </button>
    </aside>
  );
}

export default EntranceCounterSheet;
