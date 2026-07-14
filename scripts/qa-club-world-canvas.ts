import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldUseClubWorldFallback } from "../src/components/immersive/ClubWorldCanvas";

const normalDesktop = {
  reducedMotion: false,
  saveData: false,
  hardwareConcurrency: 8,
  deviceMemoryGb: 8
};

assert.equal(shouldUseClubWorldFallback(normalDesktop), false, "normal desktops must retain the WebGL scene");
assert.equal(shouldUseClubWorldFallback({ ...normalDesktop, reducedMotion: true }), true, "reduced motion must use CSS fallback");
assert.equal(shouldUseClubWorldFallback({ ...normalDesktop, saveData: true }), true, "save-data must use CSS fallback");
assert.equal(shouldUseClubWorldFallback({ ...normalDesktop, hardwareConcurrency: 2 }), true, "two-core devices must use CSS fallback");
assert.equal(shouldUseClubWorldFallback({ ...normalDesktop, deviceMemoryGb: 4 }), true, "memory-constrained devices must use CSS fallback");
assert.equal(
  shouldUseClubWorldFallback({ ...normalDesktop, hardwareConcurrency: null, deviceMemoryGb: null }),
  false,
  "missing performance hints must not disable WebGL on otherwise normal clients"
);

const source = readFileSync(new URL("../src/components/immersive/ClubWorldCanvas.tsx", import.meta.url), "utf8");
assert.match(source, /requestIdleCallback\(work, \{ timeout: 1_500 \}\)/, "Three.js initialization must be scheduled during idle time");
assert.match(source, /\}, 900\);/, "Three.js initialization must wait until after the critical first-render window");
assert.match(source, /if \(disposed \|\| initializationStarted \|\| document\.hidden\) return;/, "hidden documents must not initialize Three.js");
assert.match(source, /if \(!isVisible\) \{[\s\S]*cancelAnimationFrame\(frame\);[\s\S]*frame = 0;[\s\S]*return;/, "visibility changes must cancel the active RAF");
assert.match(source, /if \(!isVisible \|\| document\.hidden\) return;/, "a queued RAF must exit without rendering while hidden");
assert.match(source, /reducedMotionQuery\.addEventListener\("change", onReducedMotionChange\)/, "runtime reduced-motion changes must disable WebGL");
assert.match(source, /reducedMotionQuery\.removeEventListener\("change", onReducedMotionChange\)/, "reduced-motion listener must be cleaned up");
assert.doesNotMatch(source, /frame = allowMotion \? window\.requestAnimationFrame/, "the hidden-tab RAF polling loop must not return");

console.table([
  { contract: "desktop", result: "idle WebGL retained" },
  { contract: "accessibility/data/device", result: "CSS fallback" },
  { contract: "hidden tab", result: "RAF cancelled and not rescheduled" }
]);
