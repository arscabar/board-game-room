import React, { useState, type PointerEvent, type ReactNode } from "react";
import { playClickSound, playSwipeSound } from "../../utils/haptics";
import "./interactive-game-wrapper.css";

export type InteractiveGameWrapperProps = {
  children: ReactNode;
  isMyTurn: boolean;
};

function isGameInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  
  // Standard UI targets
  if (target.closest("button, input, select, textarea, a")) return true;
  
  // Game-specific targets often used in the 14 games
  if (target.closest(".cell, .piece, .stone, .card, .block, .board-space, .grid-cell, [data-cell-id], [role='button']")) return true;
  
  return false;
}

export function InteractiveGameWrapper({ children, isMyTurn }: InteractiveGameWrapperProps) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return; // Reduce tilt on touch devices for stability
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2; // -1 to +1
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2; // -1 to +1

    // Limit the maximum tilt to subtle angles (e.g., max 3-5 degrees)
    setTilt({
      x: x * 3,
      y: y * -3
    });
  }

  function handlePointerLeave() {
    setTilt({ x: 0, y: 0 });
  }

  function handlePointerDownCapture(e: PointerEvent<HTMLDivElement>) {
    // Intercept clicks on interactive elements to inject global haptics
    if (isGameInteractiveTarget(e.target)) {
      // Vary the sound slightly based on whether it's our turn
      if (isMyTurn) {
        playClickSound();
      } else {
        // Just a subtle tap if clicking around when it's not our turn
        playSwipeSound(); 
      }
    }
  }

  return (
    <div 
      className={`interactive-game-wrapper ${isMyTurn ? "is-my-turn" : ""}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDownCapture={handlePointerDownCapture}
      style={{
        transform: `perspective(1000px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg) scale3d(1, 1, 1)`,
        transition: tilt.x === 0 && tilt.y === 0 ? "transform 0.5s ease-out" : "transform 0.1s linear"
      }}
    >
      <div className="interactive-game-ambient-light" aria-hidden="true" />
      <div className="interactive-game-content">
        {children}
      </div>
    </div>
  );
}
