import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject
} from "react";
import type { CafeBounds, CafePoint } from "./interactive-space.types";
import { useReducedMotionPreference } from "./useReducedMotionPreference";

export type CafeCameraPosition = Readonly<{
  x: number;
  y: number;
  scale: number;
}>;

export type CameraBounds = CafeBounds & {
  minScale?: number;
  maxScale?: number;
};

export type CafeCameraOptions = Readonly<{
  initial?: Partial<CafeCameraPosition>;
  bounds?: CameraBounds;
  disabled?: boolean;
  keyboard?: boolean;
  nudgeAmount?: number;
  dragThreshold?: number;
  panButton?: number;
  inertia?: boolean;
  inertiaDurationMs?: number;
  inertiaStrength?: number;
  maxInertiaDistance?: number;
  reducedMotion?: boolean;
  panOnInteractiveElements?: boolean;
  shouldStartPan?: (event: PointerEvent<HTMLElement>) => boolean;
  onCameraChange?: (camera: CafeCameraPosition) => void;
}>;

export type CafeCameraCssVariables = CSSProperties & {
  "--cafe-camera-x": string;
  "--cafe-camera-y": string;
  "--cafe-camera-scale": string;
  "--cafe-camera-motion": string;
};

type CameraSetOptions = Readonly<{
  animate?: boolean;
  notify?: boolean;
  commitState?: boolean;
  fallbackElement?: HTMLElement | null;
}>;

type CameraDrag = {
  pointerId: number;
  start: CafePoint;
  origin: CafeCameraPosition;
  moved: boolean;
  last: CafePoint;
  lastTime: number;
  velocity: CafePoint;
};

type NormalizedCafeCameraOptions = Required<
  Pick<
    CafeCameraOptions,
    | "bounds"
    | "disabled"
    | "keyboard"
    | "nudgeAmount"
    | "dragThreshold"
    | "panButton"
    | "inertia"
    | "inertiaDurationMs"
    | "inertiaStrength"
    | "maxInertiaDistance"
    | "reducedMotion"
    | "panOnInteractiveElements"
  >
> &
  Pick<CafeCameraOptions, "initial" | "shouldStartPan" | "onCameraChange">;

const defaultBounds: Required<CameraBounds> = {
  minX: -260,
  maxX: 260,
  minY: -180,
  maxY: 180,
  minScale: 0.86,
  maxScale: 1.12
};

const interactivePanSelector = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[data-cafe-pan-disabled]"
].join(",");

function clamp(value: number, min?: number, max?: number) {
  if (typeof min === "number" && value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}

function toInitialCamera(initial: Partial<CafeCameraPosition> | undefined): CafeCameraPosition {
  return {
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    scale: initial?.scale ?? 1
  };
}

function clampCamera(camera: CafeCameraPosition, bounds: CameraBounds): CafeCameraPosition {
  return {
    x: clamp(camera.x, bounds.minX, bounds.maxX),
    y: clamp(camera.y, bounds.minY, bounds.maxY),
    scale: clamp(camera.scale, bounds.minScale, bounds.maxScale)
  };
}

function isOptions(value: CameraBounds | CafeCameraOptions): value is CafeCameraOptions {
  return (
    "bounds" in value ||
    "initial" in value ||
    "disabled" in value ||
    "keyboard" in value ||
    "onCameraChange" in value ||
    "shouldStartPan" in value
  );
}

function normalizeOptions(input: CameraBounds | CafeCameraOptions | undefined, reducedMotion: boolean): NormalizedCafeCameraOptions {
  const rawOptions = input && isOptions(input) ? input : { bounds: input };
  const bounds = {
    ...defaultBounds,
    ...rawOptions.bounds
  };

  return {
    initial: rawOptions.initial,
    bounds,
    disabled: rawOptions.disabled ?? false,
    keyboard: rawOptions.keyboard ?? true,
    nudgeAmount: rawOptions.nudgeAmount ?? 48,
    dragThreshold: rawOptions.dragThreshold ?? 4,
    panButton: rawOptions.panButton ?? 0,
    inertia: rawOptions.inertia ?? true,
    inertiaDurationMs: rawOptions.inertiaDurationMs ?? 160,
    inertiaStrength: rawOptions.inertiaStrength ?? 0.32,
    maxInertiaDistance: rawOptions.maxInertiaDistance ?? 120,
    reducedMotion: rawOptions.reducedMotion ?? reducedMotion,
    panOnInteractiveElements: rawOptions.panOnInteractiveElements ?? false,
    shouldStartPan: rawOptions.shouldStartPan,
    onCameraChange: rawOptions.onCameraChange
  };
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
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

function shouldIgnorePanTarget(target: EventTarget | null, currentTarget: HTMLElement) {
  if (!(target instanceof HTMLElement) || target === currentTarget) {
    return false;
  }

  return Boolean(target.closest(interactivePanSelector));
}

export function useCafeCamera<TViewport extends HTMLElement = HTMLElement, TLayer extends HTMLElement = HTMLElement>(
  optionsOrBounds: CameraBounds | CafeCameraOptions = defaultBounds
) {
  const detectedReducedMotion = useReducedMotionPreference();
  const normalizedOptions = normalizeOptions(optionsOrBounds, detectedReducedMotion);
  const optionsRef = useLatestRef(normalizedOptions);
  const initialCameraRef = useRef(clampCamera(toInitialCamera(normalizedOptions.initial), normalizedOptions.bounds));
  const cameraRef = useRef<CafeCameraPosition>(initialCameraRef.current);
  const viewportRef = useRef<TViewport | null>(null);
  const layerRef = useRef<TLayer | null>(null);
  const dragRef = useRef<CameraDrag | null>(null);
  const frameRef = useRef<number | null>(null);
  const inertiaFrameRef = useRef<number | null>(null);
  const pendingCameraRef = useRef(cameraRef.current);
  const pendingMotionRef = useRef("0ms");
  const [camera, setCameraState] = useState<CafeCameraPosition>(cameraRef.current);
  const [dragging, setDragging] = useState(false);

  const writeCameraVars = useCallback((cameraValue: CafeCameraPosition, motion: string, fallbackElement?: HTMLElement | null) => {
    const target = layerRef.current ?? fallbackElement ?? viewportRef.current;
    if (!target) {
      return;
    }

    target.style.setProperty("--cafe-camera-x", `${cameraValue.x}px`);
    target.style.setProperty("--cafe-camera-y", `${cameraValue.y}px`);
    target.style.setProperty("--cafe-camera-scale", `${cameraValue.scale}`);
    target.style.setProperty("--cafe-camera-motion", motion);
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const applyCamera = useCallback(
    (nextCamera: Partial<CafeCameraPosition>, setOptions: CameraSetOptions = {}) => {
      const options = optionsRef.current;
      const merged = {
        x: nextCamera.x ?? cameraRef.current.x,
        y: nextCamera.y ?? cameraRef.current.y,
        scale: nextCamera.scale ?? cameraRef.current.scale
      };
      const clamped = clampCamera(merged, options.bounds);
      const motion = setOptions.animate && !options.reducedMotion ? "140ms" : "0ms";

      cameraRef.current = clamped;
      pendingCameraRef.current = clamped;
      pendingMotionRef.current = motion;

      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          writeCameraVars(pendingCameraRef.current, pendingMotionRef.current, setOptions.fallbackElement);
        });
      }

      if (setOptions.commitState ?? true) {
        setCameraState(clamped);
      }

      if (setOptions.notify !== false) {
        options.onCameraChange?.(clamped);
      }

      return clamped;
    },
    [optionsRef, writeCameraVars]
  );

  const moveCamera = useCallback(
    (next: Partial<CafeCameraPosition>) => {
      stopInertia();
      return applyCamera(next, { animate: true, commitState: true });
    },
    [applyCamera, stopInertia]
  );

  const nudge = useCallback(
    (deltaX: number, deltaY: number) => {
      stopInertia();
      return applyCamera(
        {
          x: cameraRef.current.x + deltaX,
          y: cameraRef.current.y + deltaY
        },
        { animate: true, commitState: true }
      );
    },
    [applyCamera, stopInertia]
  );

  const centerOn = useCallback(
    (point: CafePoint, options: { scale?: number; animate?: boolean } = {}) => {
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      const scale = options.scale ?? cameraRef.current.scale;
      return applyCamera(
        {
          x: (viewportRect?.width ?? 0) / 2 - point.x * scale,
          y: (viewportRect?.height ?? 0) / 2 - point.y * scale,
          scale
        },
        { animate: options.animate ?? true, commitState: true }
      );
    },
    [applyCamera]
  );

  const resetCamera = useCallback(
    () => {
      stopInertia();
      return applyCamera(initialCameraRef.current, { animate: true, commitState: true });
    },
    [applyCamera, stopInertia]
  );

  const startInertia = useCallback(
    (velocity: CafePoint) => {
      const options = optionsRef.current;
      if (!options.inertia || options.reducedMotion) {
        setCameraState(cameraRef.current);
        return;
      }

      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed < 0.02) {
        setCameraState(cameraRef.current);
        return;
      }

      const rawX = velocity.x * options.inertiaDurationMs * options.inertiaStrength;
      const rawY = velocity.y * options.inertiaDurationMs * options.inertiaStrength;
      const distance = Math.hypot(rawX, rawY);
      const distanceScale = distance > options.maxInertiaDistance ? options.maxInertiaDistance / distance : 1;
      const deltaX = rawX * distanceScale;
      const deltaY = rawY * distanceScale;
      const startCamera = cameraRef.current;
      const startedAt = performance.now();

      stopInertia();

      const step = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / options.inertiaDurationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        applyCamera(
          {
            x: startCamera.x + deltaX * eased,
            y: startCamera.y + deltaY * eased,
            scale: startCamera.scale
          },
          { animate: false, notify: progress >= 1, commitState: progress >= 1 }
        );

        if (progress < 1) {
          inertiaFrameRef.current = window.requestAnimationFrame(step);
        } else {
          inertiaFrameRef.current = null;
        }
      };

      inertiaFrameRef.current = window.requestAnimationFrame(step);
    },
    [applyCamera, optionsRef, stopInertia]
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<TViewport>) => {
      const options = optionsRef.current;
      if (options.disabled || !event.isPrimary) {
        return;
      }

      if (event.pointerType === "mouse" && event.button !== options.panButton) {
        return;
      }

      if (options.shouldStartPan && !options.shouldStartPan(event as PointerEvent<HTMLElement>)) {
        return;
      }

      if (!options.panOnInteractiveElements && shouldIgnorePanTarget(event.target, event.currentTarget)) {
        return;
      }

      stopInertia();
      safelySetPointerCapture(event.currentTarget, event.pointerId);
      const now = performance.now();
      dragRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        origin: cameraRef.current,
        moved: false,
        last: { x: event.clientX, y: event.clientY },
        lastTime: now,
        velocity: { x: 0, y: 0 }
      };
      event.currentTarget.setAttribute("data-camera-dragging", "pending");
      setDragging(true);
    },
    [optionsRef, stopInertia]
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<TViewport>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || optionsRef.current.disabled) {
        return;
      }

      const delta = {
        x: event.clientX - drag.start.x,
        y: event.clientY - drag.start.y
      };
      const distance = Math.hypot(delta.x, delta.y);
      const now = performance.now();
      const elapsed = Math.max(1, now - drag.lastTime);

      drag.velocity = {
        x: (event.clientX - drag.last.x) / elapsed,
        y: (event.clientY - drag.last.y) / elapsed
      };
      drag.last = { x: event.clientX, y: event.clientY };
      drag.lastTime = now;

      if (!drag.moved && distance < optionsRef.current.dragThreshold) {
        return;
      }

      drag.moved = true;
      event.preventDefault();
      event.currentTarget.setAttribute("data-camera-dragging", "true");
      applyCamera(
        {
          x: drag.origin.x + delta.x,
          y: drag.origin.y + delta.y,
          scale: drag.origin.scale
        },
        {
          animate: false,
          commitState: false,
          fallbackElement: event.currentTarget
        }
      );
    },
    [applyCamera, optionsRef]
  );

  const finishDrag = useCallback(
    (event: PointerEvent<TViewport>, cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      dragRef.current = null;
      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
      event.currentTarget.removeAttribute("data-camera-dragging");
      setDragging(false);

      if (cancelled || !drag.moved) {
        setCameraState(cameraRef.current);
        return;
      }

      startInertia(drag.velocity);
    },
    [startInertia]
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<TViewport>) => {
      finishDrag(event, false);
    },
    [finishDrag]
  );

  const onPointerCancel = useCallback(
    (event: PointerEvent<TViewport>) => {
      finishDrag(event, true);
    },
    [finishDrag]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<TViewport>) => {
      const options = optionsRef.current;
      if (options.disabled || !options.keyboard) {
        return;
      }

      const baseStep = options.nudgeAmount;
      const step = event.shiftKey ? baseStep * 2 : event.altKey ? baseStep / 2 : baseStep;
      const deltas: Record<string, [number, number] | undefined> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step]
      };
      const delta = deltas[event.key];

      if (!delta) {
        return;
      }

      event.preventDefault();
      nudge(delta[0], delta[1]);
    },
    [nudge, optionsRef]
  );

  const getCamera = useCallback(() => cameraRef.current, []);

  const cameraStyle = useMemo<CafeCameraCssVariables>(
    () => ({
      "--cafe-camera-x": `${camera.x}px`,
      "--cafe-camera-y": `${camera.y}px`,
      "--cafe-camera-scale": `${camera.scale}`,
      "--cafe-camera-motion": normalizedOptions.reducedMotion ? "1ms" : "220ms",
      transform: "translate3d(var(--cafe-camera-x), var(--cafe-camera-y), 0) scale(var(--cafe-camera-scale))",
      transformOrigin: "0 0",
      transition: "transform var(--cafe-camera-motion) ease-out",
      willChange: "transform"
    }),
    [camera.x, camera.y, camera.scale, normalizedOptions.reducedMotion]
  );

  const viewportStyle = useMemo<CSSProperties>(
    () => ({
      touchAction: "none",
      userSelect: "none",
      WebkitUserSelect: "none"
    }),
    []
  );

  const cameraHandlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onKeyDown
    }),
    [onKeyDown, onPointerCancel, onPointerDown, onPointerMove, onPointerUp]
  );

  const viewportProps = useMemo(
    () => ({
      ref: viewportRef as RefObject<TViewport | null>,
      style: viewportStyle,
      tabIndex: normalizedOptions.keyboard ? 0 : undefined,
      ...cameraHandlers
    }),
    [cameraHandlers, normalizedOptions.keyboard, viewportStyle]
  );

  const layerProps = useMemo(
    () => ({
      ref: layerRef as RefObject<TLayer | null>,
      style: cameraStyle
    }),
    [cameraStyle]
  );

  useEffect(() => {
    writeCameraVars(cameraRef.current, "0ms");

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (inertiaFrameRef.current !== null) {
        window.cancelAnimationFrame(inertiaFrameRef.current);
      }
    };
  }, [writeCameraVars]);

  return {
    camera,
    cameraStyle,
    dragging,
    moveCamera,
    cameraHandlers,
    viewportRef,
    layerRef,
    viewportStyle,
    viewportProps,
    layerProps,
    getCamera,
    setCamera: moveCamera,
    nudge,
    centerOn,
    resetCamera
  };
}
