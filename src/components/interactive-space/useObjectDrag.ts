import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent
} from "react";
import type { CafePoint, DragInputSource, DragPhase, DragState } from "./interactive-space.types";

export type DropHitTest<TItem, TDropTarget, TElement extends HTMLElement> = (
  point: CafePoint,
  context: {
    item: TItem | null;
    sourceElement: TElement;
    pointerType: DragInputSource;
    event: PointerEvent<TElement>;
  }
) => TDropTarget | null;

export type ObjectDragResult<TItem, TDropTarget> = Readonly<{
  item: TItem | null;
  dropTarget: TDropTarget | null;
  dropTargetId: string | null;
  point: CafePoint;
  delta: CafePoint;
  pointerType: DragInputSource;
  wasValidDrop: boolean;
}>;

export type ObjectTapResult<TItem> = Readonly<{
  item: TItem | null;
  point: CafePoint;
  pointerType: DragInputSource;
}>;

export type UseObjectDragOptions<TItem = unknown, TDropTarget = boolean, TElement extends HTMLElement = HTMLElement> = Readonly<{
  item?: TItem;
  enabled?: boolean;
  disabled?: boolean;
  threshold?: number;
  touchThreshold?: number;
  penThreshold?: number;
  settleMs?: number;
  capturePointer?: boolean;
  touchAction?: CSSProperties["touchAction"];
  isOverDropTarget?: (point: CafePoint) => boolean;
  hitTest?: DropHitTest<TItem, TDropTarget, TElement>;
  getDropTargetId?: (target: TDropTarget) => string | null;
  shouldStartDrag?: (event: PointerEvent<TElement>, item: TItem | null) => boolean;
  onTap?: (result: ObjectTapResult<TItem>, event: PointerEvent<TElement>) => void;
  onDragStart?: (state: DragState<TItem | null, TDropTarget>, event: PointerEvent<TElement>) => void;
  onDragMove?: (state: DragState<TItem | null, TDropTarget>, event: PointerEvent<TElement>) => void;
  onDrop?: (point: CafePoint, result: ObjectDragResult<TItem, TDropTarget>, event: PointerEvent<TElement>) => void;
  onDropTarget?: (result: ObjectDragResult<TItem, TDropTarget>, event: PointerEvent<TElement>) => void;
  onCancel?: (state: DragState<TItem | null, TDropTarget>, reason: "pointer-cancel" | "manual") => void;
}>;

type ActiveDrag<TItem, TDropTarget, TElement extends HTMLElement> = {
  item: TItem | null;
  pointerId: number;
  pointerType: DragInputSource;
  sourceElement: TElement;
  origin: CafePoint;
  current: CafePoint;
  delta: CafePoint;
  moved: boolean;
  dragStarted: boolean;
  dropTarget: TDropTarget | null;
  dropTargetId: string | null;
  startedAt: number;
};

const zeroPoint: CafePoint = { x: 0, y: 0 };

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function toInputSource(pointerType: string): DragInputSource {
  if (pointerType === "touch" || pointerType === "pen" || pointerType === "mouse") {
    return pointerType;
  }

  return "mouse";
}

function createIdleState<TItem, TDropTarget>(): DragState<TItem | null, TDropTarget> {
  return {
    phase: "idle",
    item: null,
    pointerId: null,
    source: "programmatic",
    origin: zeroPoint,
    current: zeroPoint,
    delta: zeroPoint,
    hasMoved: false,
    dropTarget: null,
    dropTargetId: null,
    startedAt: null
  };
}

function toDragState<TItem, TDropTarget, TElement extends HTMLElement>(
  active: ActiveDrag<TItem, TDropTarget, TElement>,
  phase: DragPhase
): DragState<TItem | null, TDropTarget> {
  return {
    phase,
    item: active.item,
    pointerId: active.pointerId,
    source: active.pointerType,
    origin: active.origin,
    current: active.current,
    delta: active.delta,
    hasMoved: active.moved,
    dropTarget: active.dropTarget,
    dropTargetId: active.dropTargetId,
    startedAt: active.startedAt
  };
}

function movementThreshold<TItem, TDropTarget, TElement extends HTMLElement>(
  options: UseObjectDragOptions<TItem, TDropTarget, TElement>,
  pointerType: DragInputSource
) {
  if (pointerType === "touch") {
    return options.touchThreshold ?? options.threshold ?? 10;
  }

  if (pointerType === "pen") {
    return options.penThreshold ?? options.threshold ?? 7;
  }

  return options.threshold ?? 6;
}

function sameDropTarget<TDropTarget>(
  previousTarget: TDropTarget | null,
  previousId: string | null,
  nextTarget: TDropTarget | null,
  nextId: string | null,
  usesIds: boolean
) {
  if (usesIds) {
    return previousId === nextId;
  }

  return Object.is(previousTarget, nextTarget);
}

function safelySetPointerCapture(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer capture can fail if the pointer has already ended.
  }
}

function safelyReleasePointerCapture(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // The element may have lost capture naturally.
  }
}

export function useObjectDrag<TItem = unknown, TDropTarget = boolean, TElement extends HTMLElement = HTMLElement>(
  options: UseObjectDragOptions<TItem, TDropTarget, TElement> = {}
) {
  const optionsRef = useLatestRef(options);
  const activeRef = useRef<ActiveDrag<TItem, TDropTarget, TElement> | null>(null);
  const dragStateRef = useRef<DragState<TItem | null, TDropTarget>>(createIdleState());
  const frameRef = useRef<number | null>(null);
  const settleTimeoutRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const pendingVisualRef = useRef<{ element: TElement; delta: CafePoint; phase: DragPhase } | null>(null);
  const [dragState, setDragState] = useState<DragState<TItem | null, TDropTarget>>(() => createIdleState());

  const publishState = useCallback((next: DragState<TItem | null, TDropTarget>, render = true) => {
    dragStateRef.current = next;
    if (render) {
      setDragState(next);
    }
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimeoutRef.current !== null) {
      window.clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
    }
  }, []);

  const writeDragVisual = useCallback((element: TElement, delta: CafePoint, phase: DragPhase) => {
    element.style.setProperty("--object-drag-x", `${delta.x}px`);
    element.style.setProperty("--object-drag-y", `${delta.y}px`);
    element.setAttribute("data-drag-phase", phase);
  }, []);

  const scheduleDragVisual = useCallback(
    (element: TElement, delta: CafePoint, phase: DragPhase) => {
      pendingVisualRef.current = { element, delta, phase };

      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingVisualRef.current;
        if (pending) {
          writeDragVisual(pending.element, pending.delta, pending.phase);
        }
      });
    },
    [writeDragVisual]
  );

  const resetVisual = useCallback(
    (element: TElement) => {
      scheduleDragVisual(element, zeroPoint, "idle");
      element.removeAttribute("data-drag-over-target");
    },
    [scheduleDragVisual]
  );

  const settleToIdle = useCallback(
    (delayMs: number) => {
      clearSettleTimer();

      if (delayMs <= 0) {
        publishState(createIdleState());
        return;
      }

      settleTimeoutRef.current = window.setTimeout(() => {
        settleTimeoutRef.current = null;
        publishState(createIdleState());
      }, delayMs);
    },
    [clearSettleTimer, publishState]
  );

  const testDropTarget = useCallback(
    (point: CafePoint, active: ActiveDrag<TItem, TDropTarget, TElement>, event: PointerEvent<TElement>) => {
      const opts = optionsRef.current;
      const explicitTarget =
        opts.hitTest?.(point, {
          item: active.item,
          sourceElement: active.sourceElement,
          pointerType: active.pointerType,
          event
        }) ?? null;

      if (explicitTarget) {
        return explicitTarget;
      }

      if (opts.isOverDropTarget?.(point)) {
        return true as TDropTarget;
      }

      return null;
    },
    [optionsRef]
  );

  const cancelDrag = useCallback(() => {
    const active = activeRef.current;
    if (!active) {
      return;
    }

    activeRef.current = null;
    safelyReleasePointerCapture(active.sourceElement, active.pointerId);
    resetVisual(active.sourceElement);
    const cancelled = toDragState(active, "cancelled");
    publishState(cancelled);
    optionsRef.current.onCancel?.(cancelled, "manual");
    settleToIdle(optionsRef.current.settleMs ?? 80);
  }, [optionsRef, publishState, resetVisual, settleToIdle]);

  const onPointerDown = useCallback(
    (event: PointerEvent<TElement>) => {
      const opts = optionsRef.current;
      const enabled = opts.enabled ?? !opts.disabled;
      const item = opts.item ?? null;

      if (!enabled || !event.isPrimary) {
        return;
      }

      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      if (opts.shouldStartDrag && !opts.shouldStartDrag(event, item)) {
        return;
      }

      clearSettleTimer();

      if (opts.capturePointer !== false) {
        safelySetPointerCapture(event.currentTarget, event.pointerId);
      }

      const point = { x: event.clientX, y: event.clientY } satisfies CafePoint;
      const active: ActiveDrag<TItem, TDropTarget, TElement> = {
        item,
        pointerId: event.pointerId,
        pointerType: toInputSource(event.pointerType),
        sourceElement: event.currentTarget,
        origin: point,
        current: point,
        delta: zeroPoint,
        moved: false,
        dragStarted: false,
        dropTarget: null,
        dropTargetId: null,
        startedAt: performance.now()
      };

      activeRef.current = active;
      writeDragVisual(event.currentTarget, zeroPoint, "pending");
      publishState(toDragState(active, "pending"));
    },
    [clearSettleTimer, optionsRef, publishState, writeDragVisual]
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<TElement>) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== event.pointerId) {
        return;
      }

      const opts = optionsRef.current;
      const enabled = opts.enabled ?? !opts.disabled;
      if (!enabled) {
        return;
      }

      const current = { x: event.clientX, y: event.clientY } satisfies CafePoint;
      const delta = {
        x: current.x - active.origin.x,
        y: current.y - active.origin.y
      } satisfies CafePoint;
      const distance = Math.hypot(delta.x, delta.y);

      if (!active.moved && distance < movementThreshold(opts, active.pointerType)) {
        return;
      }

      event.preventDefault();
      active.moved = true;
      active.current = current;
      active.delta = delta;

      const nextTarget = testDropTarget(current, active, event);
      const nextTargetId = nextTarget ? opts.getDropTargetId?.(nextTarget) ?? null : null;
      const targetChanged = !sameDropTarget(active.dropTarget, active.dropTargetId, nextTarget, nextTargetId, Boolean(opts.getDropTargetId));

      active.dropTarget = nextTarget;
      active.dropTargetId = nextTargetId;
      active.sourceElement.setAttribute("data-drag-over-target", nextTarget ? "true" : "false");
      scheduleDragVisual(active.sourceElement, delta, "dragging");

      const nextState = toDragState(active, "dragging");
      publishState(nextState, !active.dragStarted || targetChanged);

      if (!active.dragStarted) {
        active.dragStarted = true;
        opts.onDragStart?.(nextState, event);
      }

      opts.onDragMove?.(nextState, event);
    },
    [optionsRef, publishState, scheduleDragVisual, testDropTarget]
  );

  const finish = useCallback(
    (event: PointerEvent<TElement>, cancelled = false) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== event.pointerId) {
        return;
      }

      const opts = optionsRef.current;
      activeRef.current = null;
      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
      resetVisual(active.sourceElement);

      if (cancelled) {
        const cancelledState = toDragState(active, "cancelled");
        publishState(cancelledState);
        opts.onCancel?.(cancelledState, "pointer-cancel");
        settleToIdle(opts.settleMs ?? 80);
        return;
      }

      if (!active.moved) {
        const point = { x: event.clientX, y: event.clientY } satisfies CafePoint;
        opts.onTap?.(
          {
            item: active.item,
            point,
            pointerType: active.pointerType
          },
          event
        );
        publishState(createIdleState());
        return;
      }

      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      active.current = { x: event.clientX, y: event.clientY };
      active.delta = {
        x: active.current.x - active.origin.x,
        y: active.current.y - active.origin.y
      };
      active.dropTarget = testDropTarget(active.current, active, event) ?? active.dropTarget;
      active.dropTargetId = active.dropTarget ? opts.getDropTargetId?.(active.dropTarget) ?? active.dropTargetId : null;

      const droppedState = toDragState(active, "dropped");
      const result: ObjectDragResult<TItem, TDropTarget> = {
        item: active.item,
        dropTarget: active.dropTarget,
        dropTargetId: active.dropTargetId,
        point: active.current,
        delta: active.delta,
        pointerType: active.pointerType,
        wasValidDrop: Boolean(active.dropTarget)
      };

      publishState(droppedState);
      opts.onDrop?.(active.current, result, event);
      opts.onDropTarget?.(result, event);
      settleToIdle(opts.settleMs ?? 80);
    },
    [optionsRef, publishState, resetVisual, settleToIdle, testDropTarget]
  );

  const onClickCapture = useCallback((event: MouseEvent<TElement>) => {
    if (!suppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }, []);

  const dragStyle = useMemo(
    () =>
      ({
        "--object-drag-x": "0px",
        "--object-drag-y": "0px",
        transform: "translate3d(var(--object-drag-x), var(--object-drag-y), 0)",
        touchAction: options.touchAction ?? "none",
        willChange: "transform"
      }) as CSSProperties,
    [options.touchAction]
  );

  const dragHandlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<TElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<TElement>) => finish(event, true),
      onClickCapture
    }),
    [finish, onClickCapture, onPointerDown, onPointerMove]
  );

  const bind = useMemo(
    () => ({
      style: dragStyle,
      "data-drag-phase": dragState.phase,
      "aria-grabbed": dragState.phase === "pending" || dragState.phase === "dragging",
      ...dragHandlers
    }),
    [dragHandlers, dragState.phase, dragStyle]
  );

  const getDragState = useCallback(() => dragStateRef.current, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      clearSettleTimer();
      const active = activeRef.current;
      if (active) {
        activeRef.current = null;
        writeDragVisual(active.sourceElement, zeroPoint, "idle");
        active.sourceElement.removeAttribute("data-drag-over-target");
      }
    },
    [clearSettleTimer, writeDragVisual]
  );

  return {
    dragState,
    dragStyle,
    dragHandlers,
    bind,
    getDragState,
    cancelDrag
  };
}
