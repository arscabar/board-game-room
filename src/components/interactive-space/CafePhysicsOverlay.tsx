import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import Matter from "matter-js";

export type PhysicsOverlayHandle = {
  addToken: (x: number, y: number, color?: string) => void;
  popAll: () => void;
};

type PhysicsToken = {
  id: number;
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
  shape: "circle" | "rectangle" | "polygon";
  color: string;
};

type Props = {
  width?: number;
  height?: number;
  interactive?: boolean;
};

export const CafePhysicsOverlay = forwardRef<PhysicsOverlayHandle, Props>(({ width = 3000, height = 2000, interactive = true }, ref) => {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef(Matter.Engine.create());
  const [tokens, setTokens] = useState<PhysicsToken[]>([]);
  const tokensRef = useRef<Matter.Body[]>([]);

  useEffect(() => {
    const engine = engineRef.current;
    engine.gravity.y = 0;
    engine.gravity.x = 0; // Absolute Zero Gravity!
    
    // Add boundaries way outside so things float back eventually
    const bounds = 3000;
    const walls = [
      Matter.Bodies.rectangle(0, -bounds/2, bounds*2, 100, { isStatic: true, restitution: 1 }),
      Matter.Bodies.rectangle(0, bounds/2, bounds*2, 100, { isStatic: true, restitution: 1 }),
      Matter.Bodies.rectangle(-bounds/2, 0, 100, bounds*2, { isStatic: true, restitution: 1 }),
      Matter.Bodies.rectangle(bounds/2, 0, 100, bounds*2, { isStatic: true, restitution: 1 })
    ];
    Matter.World.add(engine.world, walls);

    // Initial floating objects
    const colors = ["#247978", "#c88b25", "#7450b8", "#b33d55"];
    for (let i = 0; i < 20; i++) {
      const isRect = Math.random() > 0.5;
      const size = 30 + Math.random() * 40;
      let body;
      const x = (Math.random() - 0.5) * 2000;
      const y = (Math.random() - 0.5) * 1000;
      
      if (isRect) {
         body = Matter.Bodies.rectangle(x, y, size, size, {
            restitution: 0.9, frictionAir: 0.001,
            render: { fillStyle: colors[Math.floor(Math.random() * colors.length)] }
         });
         (body as any).customShape = "rectangle";
      } else {
         body = Matter.Bodies.polygon(x, y, Math.floor(3 + Math.random() * 4), size/2, {
            restitution: 0.9, frictionAir: 0.001,
            render: { fillStyle: colors[Math.floor(Math.random() * colors.length)] }
         });
         (body as any).customShape = "polygon";
      }
      
      Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 });
      Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05);
      
      Matter.World.add(engine.world, body);
      tokensRef.current.push(body);
    }

    let animationFrameId: number;
    const runner = () => {
      Matter.Engine.update(engine, 1000 / 60);
      
      const currentTokens = tokensRef.current.map(body => {
        const bounds = body.bounds;
        const w = bounds.max.x - bounds.min.x;
        const h = bounds.max.y - bounds.min.y;
        return {
          id: body.id,
          x: body.position.x,
          y: body.position.y,
          angle: body.angle,
          width: body.circleRadius ? body.circleRadius * 2 : w,
          height: body.circleRadius ? body.circleRadius * 2 : h,
          shape: body.circleRadius ? "circle" : ((body as any).customShape || "rectangle"),
          color: body.render.fillStyle || "#247978"
        };
      });
      setTokens(currentTokens);

      animationFrameId = requestAnimationFrame(runner);
    };
    runner();

    return () => {
      cancelAnimationFrame(animationFrameId);
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      tokensRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!interactive || !sceneRef.current) return;
    const engine = engineRef.current;
    
    const mouse = Matter.Mouse.create(sceneRef.current);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: { stiffness: 0.1, render: { visible: false } }
    });
    Matter.World.add(engine.world, mouseConstraint);

    return () => {
      Matter.World.remove(engine.world, mouseConstraint);
    };
  }, [interactive]);

  useImperativeHandle(ref, () => ({
    addToken: (x: number, y: number, color = "#fff") => {
      const radius = 25;
      const token = Matter.Bodies.circle(x, y, radius, {
        restitution: 0.9, frictionAir: 0.01,
        render: { fillStyle: color }
      });
      Matter.Body.setVelocity(token, {
        x: (Math.random() - 0.5) * 15, y: (Math.random() - 0.5) * 15
      });
      Matter.World.add(engineRef.current.world, token);
      tokensRef.current.push(token);
    },
    popAll: () => {
      tokensRef.current.forEach(body => {
        Matter.Body.applyForce(body, body.position, {
          x: (Math.random() - 0.5) * 0.1 * body.mass,
          y: (Math.random() - 0.5) * 0.1 * body.mass
        });
      });
    }
  }));

  return (
    <div 
      ref={sceneRef} 
      className="cafe-physics-layer"
      style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: interactive ? 'auto' : 'none',
        transform: 'translateZ(-300px)' // Push physics layer deep in the background
      }}
    >
      {tokens.map(t => (
        <div
          key={t.id}
          style={{
            position: 'absolute',
            width: t.width, height: t.height,
            borderRadius: t.shape === 'circle' ? '50%' : (t.shape === 'rectangle' ? '12px' : '0'),
            backgroundColor: t.color,
            boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.3), 0 10px 30px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.1)',
            opacity: 0.7,
            filter: 'blur(2px)', // Cinematic depth of field effect
            clipPath: t.shape === 'polygon' ? 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' : 'none',
            transform: `translate(-50%, -50%) translate(${t.x}px, ${t.y}px) rotate(${t.angle}rad)`,
            willChange: 'transform',
            cursor: 'grab'
          }}
        />
      ))}
    </div>
  );
});
