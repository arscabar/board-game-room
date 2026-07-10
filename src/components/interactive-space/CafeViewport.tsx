import { type KeyboardEvent, useMemo, useRef } from "react";
import type { PublicRoomListItem } from "../../shared/types";
import { CafeTableObject, type CafeTablePlacement } from "./CafeTableObject";

type PreventableEvent = {
  preventDefault: () => void;
};

export type CafeViewportProps = {
  tables: CafeTablePlacement[];
  selectedTableId: string;
  canCreate: boolean;
  roomsLoading: boolean;
  lastRoomCode: string;
  createState: "idle" | "placing";
  connectionState: "connecting" | "connected" | "offline";
  onCreateTable: (event: PreventableEvent) => void;
  onSelectTable: (tableId: string) => void;
  onSelectRoom: (room: PublicRoomListItem) => void;
};

export function CafeViewport({
  tables,
  selectedTableId,
  canCreate,
  roomsLoading,
  lastRoomCode,
  createState,
  connectionState,
  onCreateTable,
  onSelectTable,
  onSelectRoom
}: CafeViewportProps) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const roomCount = tables.filter((table) => table.kind === "room").length;
  const tableIds = useMemo(() => tables.map((table) => table.id), [tables]);

  function focusTable(tableId: string) {
    onSelectTable(tableId);
    window.requestAnimationFrame(() => {
      viewportRef.current?.querySelector<HTMLButtonElement>(`[data-table-id="${tableId}"]`)?.focus();
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const currentIndex = Math.max(0, tableIds.indexOf(selectedTableId));
    const columns = window.matchMedia("(min-width: 1180px)").matches ? 3 : window.matchMedia("(min-width: 680px)").matches ? 2 : 1;
    const offsetByKey: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns
    };
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tableIds.length - 1
        : Math.max(0, Math.min(tableIds.length - 1, currentIndex + (offsetByKey[event.key] ?? 0)));

    if (nextIndex === currentIndex && event.key !== "Home" && event.key !== "End") {
      return;
    }

    event.preventDefault();
    focusTable(tableIds[nextIndex]);
  }

  return (
    <section
      className="cafe-viewport"
      data-connection={connectionState}
      ref={viewportRef}
      aria-labelledby="cafe-room-list-title"
      onKeyDown={handleKeyDown}
    >
      <header className="cafe-room-list-header">
        <div>
          <span className="cafe-section-index">01</span>
          <h3 id="cafe-room-list-title">열린 테이블</h3>
        </div>
        <span className="cafe-room-count" aria-label={`${roomCount}개 테이블`}>{roomCount}</span>
      </header>

      <div className="cafe-table-grid" role="list" aria-busy={roomsLoading}>
        {tables.map((table) => {
          const room = table.kind === "room" ? table.room ?? null : null;
          const canUseRoom = Boolean(
            room && connectionState === "connected" && (room.code === lastRoomCode || (room.canJoin && room.status === "lobby"))
          );
          const isSelected = table.id === selectedTableId;

          return (
            <div
              className={table.size === "large" ? "cafe-table-grid-item cafe-table-grid-item-large" : "cafe-table-grid-item"}
              role="listitem"
              key={table.id}
            >
              <CafeTableObject
                table={table}
                canCreate={canCreate}
                canUseRoom={canUseRoom}
                isSelected={isSelected}
                isSavedRoom={Boolean(room && room.code === lastRoomCode)}
                createState={createState}
                onCreateTable={onCreateTable}
                onSelectRoom={(nextRoom) => {
                  onSelectTable(table.id);
                  onSelectRoom(nextRoom);
                }}
              />
            </div>
          );
        })}
      </div>

      {roomsLoading ? (
        <div className="cafe-loading-chip" role="status" aria-live="polite">
          테이블을 확인하고 있습니다.
        </div>
      ) : null}
    </section>
  );
}

export default CafeViewport;
