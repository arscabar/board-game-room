import React, { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

export type ParticleTrailOverlayProps = {
  isDragging: boolean;
};

export function ParticleTrailOverlay({ isDragging }: ParticleTrailOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const prevMouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    if (!isDragging) {
      particlesRef.current = [];
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const onMove = (e: PointerEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove);

    let animationFrameId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    resize();

    const colors = ["#00f0ff", "#ff00e5", "#00ff73", "#f0e68c"];

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (isDragging) {
        // Emit particles
        const mx = mouseRef.current.x;
        const my = mouseRef.current.y;
        const dx = mx - prevMouseRef.current.x;
        const dy = my - prevMouseRef.current.y;
        const speed = Math.hypot(dx, dy);

        const count = Math.min(Math.floor(speed * 0.5) + 1, 10);
        for (let i = 0; i < count; i++) {
          particlesRef.current.push({
            x: mx + (Math.random() - 0.5) * 20,
            y: my + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 2 - dx * 0.05,
            vy: (Math.random() - 0.5) * 2 - dy * 0.05,
            life: 1,
            maxLife: 0.9 + Math.random() * 0.08, // 0.9 to 0.98 fade out
            size: 2 + Math.random() * 4,
            color: colors[Math.floor(Math.random() * colors.length)]
          });
        }
      }

      prevMouseRef.current = { x: mouseRef.current.x, y: mouseRef.current.y };

      // Update & Draw
      ctx.globalCompositeOperation = "lighter";
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1; // gravity
        p.life *= p.maxLife;

        if (p.life < 0.01) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fill();
        
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isDragging]);

  if (!isDragging) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
        zIndex: 9999
      }}
    />
  );
}
