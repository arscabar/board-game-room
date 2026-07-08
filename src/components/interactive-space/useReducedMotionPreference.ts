import { useEffect, useState } from "react";

export type ReducedMotionPreferenceOptions = Readonly<{
  ssrDefault?: boolean;
  onChange?: (prefersReducedMotion: boolean) => void;
}>;

const reducedMotionMediaQuery = "(prefers-reduced-motion: reduce)";

function readReducedMotionPreference(ssrDefault: boolean) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return ssrDefault;
  }

  return window.matchMedia(reducedMotionMediaQuery).matches;
}

export function useReducedMotionPreference(options: ReducedMotionPreferenceOptions = {}) {
  const { ssrDefault = false, onChange } = options;
  const [reducedMotion, setReducedMotion] = useState(() => readReducedMotionPreference(ssrDefault));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const query = window.matchMedia(reducedMotionMediaQuery);
    const update = () => {
      const next = query.matches;
      setReducedMotion(next);
      onChange?.(next);
    };

    update();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, [onChange]);

  return reducedMotion;
}
