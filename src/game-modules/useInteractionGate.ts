import { useCallback, useEffect, useRef, useState } from "react";
import type { GameAction } from "./types";

type ResetKey = string | number | boolean | null | undefined;

interface InteractionGateOptions {
  cooldownMs?: number;
  vibrateMs?: number;
}

function vibrateOnce(durationMs: number) {
  if (durationMs <= 0 || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(durationMs);
  } catch {
    // Some browsers expose vibrate but block it in the current context.
  }
}

export function useInteractionGate(
  onAction: (action: GameAction) => void,
  resetKeys: ResetKey[],
  { cooldownMs = 600, vibrateMs = 8 }: InteractionGateOptions = {}
) {
  const lockedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const releaseAction = useCallback(() => {
    lockedRef.current = false;
    setIsSubmitting(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    releaseAction();
  }, resetKeys);

  useEffect(() => releaseAction, [releaseAction]);

  const submitAction = useCallback(
    (action: GameAction) => {
      if (lockedRef.current) {
        return false;
      }
      lockedRef.current = true;
      setIsSubmitting(true);
      vibrateOnce(vibrateMs);
      onAction(action);
      timerRef.current = window.setTimeout(releaseAction, cooldownMs);
      return true;
    },
    [cooldownMs, onAction, releaseAction, vibrateMs]
  );

  return {
    isSubmitting,
    releaseAction,
    submitAction
  };
}
