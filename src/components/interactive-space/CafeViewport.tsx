import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
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

type Pan = {
  x: number;
  y: number;
};

type ActivePan = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a"));
}

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) {
      return undefined;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}

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
  const layerRef = useRef<HTMLDivElement | null>(null);
  const activePanRef = useRef<ActivePan | null>(null);
  const panRef = useRef<Pan>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const reducedMotion = useReducedMotionPreference();

  const tableIds = useMemo(() => tables.map((table) => table.id), [tables]);

  function setPan(nextPan: Pan) {
    const clampedPan = {
      x: clamp(nextPan.x, -240, 240),
      y: clamp(nextPan.y, -150, 150)
    };
    panRef.current = clampedPan;
    layerRef.current?.style.setProperty("--cafe-pan-x", `${clampedPan.x}px`);
    layerRef.current?.style.setProperty("--cafe-pan-y", `${clampedPan.y}px`);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    activePanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y
    };
    setIsPanning(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const activePan = activePanRef.current;
    if (!activePan || activePan.pointerId !== event.pointerId || reducedMotion) {
      return;
    }

    setPan({
      x: activePan.originX + event.clientX - activePan.startX,
      y: activePan.originY + event.clientY - activePan.startY
    });
  }

  function endPan(event: ReactPointerEvent<HTMLElement>) {
    const activePan = activePanRef.current;
    if (!activePan || activePan.pointerId !== event.pointerId) {
      return;
    }

    activePanRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    if (reducedMotion) {
      return;
    }

    const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(primaryDelta) < 2) {
      return;
    }

    event.preventDefault();
    setPan({
      x: panRef.current.x - primaryDelta * 0.24,
      y: panRef.current.y
    });
  }

  function focusTable(tableId: string) {
    const button = viewportRef.current?.querySelector<HTMLButtonElement>(`[data-table-id="${tableId}"]`);
    button?.focus();
    onSelectTable(tableId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const keyOffsets: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1
    };
    const offset = keyOffsets[event.key];
    if (!offset || tableIds.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = Math.max(0, tableIds.indexOf(selectedTableId));
    const nextIndex = (currentIndex + offset + tableIds.length) % tableIds.length;
    focusTable(tableIds[nextIndex]);
  }

  return (
    <section
      className="cafe-viewport"
      data-panning={isPanning ? "true" : "false"}
      data-connection={connectionState}
      ref={viewportRef}
      tabIndex={0}
      aria-label="보드게임 카페 테이블 공간"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
      <div className="cafe-floor-vignette" aria-hidden="true" />
      <div
        className="cafe-camera-layer"
        ref={layerRef}
        style={
          {
            "--cafe-pan-x": "0px",
            "--cafe-pan-y": "0px"
          } as CSSProperties
        }
      >
        <div className="cafe-wall-counter" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="cafe-floor-runner" aria-hidden="true" />
        <div className="cafe-sideboard" aria-hidden="true" />
        <div className="cafe-menu-board" aria-hidden="true" />

        {tables.map((table) => {
          const room = table.kind === "room" ? table.room ?? null : null;
          const canUseRoom = Boolean(
            room && connectionState === "connected" && (room.code === lastRoomCode || (room.canJoin && room.status === "lobby"))
          );
          return (
            <CafeTableObject
              key={table.id}
              table={table}
              canCreate={canCreate}
              canUseRoom={canUseRoom}
              isSelected={selectedTableId === table.id}
              isSavedRoom={Boolean(room && room.code === lastRoomCode)}
              createState={createState}
              onCreateTable={onCreateTable}
              onSelectRoom={(nextRoom) => {
                onSelectTable(table.id);
                onSelectRoom(nextRoom);
              }}
            />
          );
        })}
      </div>

      {roomsLoading ? (
        <div className="cafe-loading-chip" role="status" aria-live="polite">
          테이블 정리 중
        </div>
      ) : null}
    </section>
  );
}

export default CafeViewport;
