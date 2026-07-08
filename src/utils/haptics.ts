// Web Audio API Synthesizer for high-end haptic sounds

let audioCtx: AudioContext | null = null;

function getAudioContext() {
  if (!audioCtx && typeof window !== 'undefined') {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

// 1. Swipe/Tick Sound (When Cover Flow cards change)
export function playSwipeSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = "sine";
  osc.frequency.setValueAtTime(300, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.05);

  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.05);
}

// 2. Token Drop / Click Sound (When lifting or dropping token)
export function playClickSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = "triangle";
  osc.frequency.setValueAtTime(800, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.08);

  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}

// 3. Cinematic Join Room (Explosion / Whoosh)
export function playJoinSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  // Create a layered cinematic whoosh
  const osc = ctx.createOscillator();
  const noise = ctx.createBufferSource();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  // White noise burst
  const bufferSize = ctx.sampleRate * 0.5; // 0.5 seconds
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noise.buffer = buffer;
  
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(5000, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.5);

  osc.type = "sine";
  osc.frequency.setValueAtTime(100, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.5);

  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

  noise.connect(filter);
  filter.connect(gain);
  osc.connect(gain);
  gain.connect(ctx.destination);

  noise.start();
  osc.start();
  noise.stop(ctx.currentTime + 0.5);
  osc.stop(ctx.currentTime + 0.5);
}
