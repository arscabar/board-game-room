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
  mouseX: number;
  mouseY: number;
};

export function ParticleTrailOverlay({ isDragging, mouseX, mouseY }: ParticleTrailOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const prevMouseRef = useRef({ x: mouseX, y: mouseY });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
        const dx = mouseX - prevMouseRef.current.x;
        const dy = mouseY - prevMouseRef.current.y;
        const speed = Math.hypot(dx, dy);

        const count = Math.min(Math.floor(speed * 0.5) + 1, 10);
        for (let i = 0; i < count; i++) {
          particlesRef.current.push({
            x: mouseX + (Math.random() - 0.5) * 20,
            y: mouseY + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 2 - dx * 0.05,
            vy: (Math.random() - 0.5) * 2 - dy * 0.05,
            life: 1,
            maxLife: 0.9 + Math.random() * 0.08, // 0.9 to 0.98 fade out
            size: 2 + Math.random() * 4,
            color: colors[Math.floor(Math.random() * colors.length)]
          });
        }
      }

      prevMouseRef.current = { x: mouseX, y: mouseY };

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
      cancelAnimationFrame(animationFrameId);
    };
  }, [isDragging, mouseX, mouseY]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 9999
      }}
    />
  );
}
