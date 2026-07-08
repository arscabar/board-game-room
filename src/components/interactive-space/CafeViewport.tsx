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
import { CafePhysicsOverlay, type PhysicsOverlayHandle } from "./CafePhysicsOverlay";
import { playSwipeSound } from "../../utils/haptics";

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
  const physicsRef = useRef<PhysicsOverlayHandle | null>(null);
  const reducedMotion = useReducedMotionPreference();
  
  // Carousel swipe state
  const dragRef = useRef({ isDragging: false, startX: 0, lastX: 0, velocity: 0, startTime: 0 });

  const tableIds = useMemo(() => tables.map((table) => table.id), [tables]);
  const selectedIndex = Math.max(0, tableIds.indexOf(selectedTableId));

  // Handle Cover Flow scrolling
  function handleWheel(event: WheelEvent<HTMLElement>) {
    if (reducedMotion) return;

    const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(primaryDelta) < 10) return;

    // Prevent scrolling page
    event.preventDefault();

    if (primaryDelta > 0) {
      const nextIndex = Math.min(tableIds.length - 1, selectedIndex + 1);
      if (nextIndex !== selectedIndex) {
         playSwipeSound();
         onSelectTable(tableIds[nextIndex]);
      }
    } else {
      const prevIndex = Math.max(0, selectedIndex - 1);
      if (prevIndex !== selectedIndex) {
         playSwipeSound();
         onSelectTable(tableIds[prevIndex]);
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const keyOffsets: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1
    };
    const offset = keyOffsets[event.key];
    if (!offset || tableIds.length === 0) return;

    event.preventDefault();
    const nextIndex = (selectedIndex + offset + tableIds.length) % tableIds.length;
    const button = viewportRef.current?.querySelector<HTMLButtonElement>(`[data-table-id="${tableIds[nextIndex]}"]`);
    button?.focus();
    playSwipeSound();
    onSelectTable(tableIds[nextIndex]);
  }

  // Handle Drag to Join Dropzone
  function handleDrop(event: ReactPointerEvent<HTMLElement>) {
     // Handled globally in InteractiveCafeHome now, but we keep physics pop
     if (tables[selectedIndex]?.kind === "room") {
        const room = tables[selectedIndex].room;
        if (room && (room.code === lastRoomCode || (room.canJoin && room.status === "lobby"))) {
           physicsRef.current?.popAll();
        }
     }
  }

  // Flick-to-Spin Pointer Events
  function handlePointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;

    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      lastX: e.clientX,
      velocity: 0,
      startTime: performance.now()
    };
    // Do NOT capture yet. Let clicks pass through.
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current.isDragging) return;
    const dx = e.clientX - dragRef.current.lastX;
    dragRef.current.velocity = dx;
    dragRef.current.lastX = e.clientX;

    // If they drag significantly, capture the pointer to prevent accidental clicks
    if (Math.abs(e.clientX - dragRef.current.startX) > 5) {
       if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.setPointerCapture(e.pointerId);
       }
    }

    // If they dragged enough instantly snap to next
    if (Math.abs(e.clientX - dragRef.current.startX) > 50) {
       dragRef.current.startX = e.clientX; // reset
       if (dx < 0) {
          const nextIndex = Math.min(tableIds.length - 1, selectedIndex + 1);
          if (nextIndex !== selectedIndex) {
             playSwipeSound();
             onSelectTable(tableIds[nextIndex]);
          }
       } else if (dx > 0) {
          const prevIndex = Math.max(0, selectedIndex - 1);
          if (prevIndex !== selectedIndex) {
             playSwipeSound();
             onSelectTable(tableIds[prevIndex]);
          }
       }
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current.isDragging) return;
    dragRef.current.isDragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    
    // Inertia
    const v = dragRef.current.velocity;
    if (Math.abs(v) > 10) {
      // Fast flick
      const step = v < 0 ? 1 : -1;
      const targetIndex = Math.max(0, Math.min(tableIds.length - 1, selectedIndex + step * 2));
      if (targetIndex !== selectedIndex) {
         playSwipeSound();
         setTimeout(() => onSelectTable(tableIds[targetIndex]), 150);
      }
    } else {
      // Check if it was a drop (no movement)
      const duration = performance.now() - dragRef.current.startTime;
      if (Math.abs(e.clientX - dragRef.current.startX) < 10 && duration < 500) {
         handleDrop(e);
      }
    }
  }

  return (
    <section
      className="cafe-viewport coverflow-viewport"
      data-connection={connectionState}
      ref={viewportRef}
      tabIndex={0}
      aria-label="보드게임 방 갤러리"
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="cafe-floor-vignette" aria-hidden="true" />
      <div
        className="cafe-camera-layer coverflow-layer"
        ref={layerRef}
      >
        {/* Cinematic Physics Layer (Zero Gravity) */}
        {!reducedMotion && (
          <CafePhysicsOverlay ref={physicsRef} width={3000} height={2000} interactive={true} />
        )}

        {tables.map((table, idx) => {
          const room = table.kind === "room" ? table.room ?? null : null;
          const canUseRoom = Boolean(
            room && connectionState === "connected" && (room.code === lastRoomCode || (room.canJoin && room.status === "lobby"))
          );
          
          // Cover Flow Math
          const offset = idx - selectedIndex;
          const absOffset = Math.abs(offset);
          const isSelected = offset === 0;

          // Replace old positional data with Cover Flow data
          const coverflowStyle = {
             "--cafe-table-x": `${offset * 320}px`,
             "--cafe-table-y": `0px`,
             "--cafe-table-rotate": `${offset === 0 ? 0 : offset > 0 ? -45 : 45}deg`,
             "--cafe-table-scale": isSelected ? 1.2 : 0.8,
             "--cafe-table-depth": -absOffset * 150
          } as CSSProperties;

          return (
            <div key={table.id} className="coverflow-item" style={coverflowStyle}>
              <CafeTableObject
                table={table}
                canCreate={canCreate}
                canUseRoom={canUseRoom}
                isSelected={isSelected}
                isSavedRoom={Boolean(room && room.code === lastRoomCode)}
                createState={createState}
                onCreateTable={(e) => {
                  if (table.kind === "empty" || isSelected) {
                     onCreateTable(e);
                  } else {
                     e.preventDefault();
                     onSelectTable(table.id);
                  }
                }}
                onSelectRoom={(nextRoom) => {
                  if (isSelected) {
                     onSelectRoom(nextRoom);
                  } else {
                     onSelectTable(table.id);
                  }
                }}
              />
            </div>
          );
        })}
      </div>

      {roomsLoading ? (
        <div className="cafe-loading-chip" role="status" aria-live="polite">
          방 찾는 중...
        </div>
      ) : null}
    </section>
  );
}

export default CafeViewport;
