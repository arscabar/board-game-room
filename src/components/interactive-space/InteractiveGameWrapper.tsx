import React, { type PointerEvent, type ReactNode } from "react";
import { playClickSound, playSwipeSound } from "../../utils/haptics";
import "./interactive-game-wrapper.css";

export type InteractiveGameWrapperProps = {
  children: ReactNode;
  isInteractive: boolean;
};

function isGameInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  
  // Standard UI targets
  if (target.closest("button, input, select, textarea, a")) return true;
  
  // Game-specific targets often used in the 14 games
  if (target.closest(".cell, .piece, .stone, .card, .block, .board-space, .grid-cell, [data-cell-id], [role='button']")) return true;
  
  return false;
}

export function InteractiveGameWrapper({ children, isInteractive }: InteractiveGameWrapperProps) {
  function handlePointerDownCapture(e: PointerEvent<HTMLDivElement>) {
    // Intercept clicks on interactive elements to inject global haptics
    if (isGameInteractiveTarget(e.target)) {
      // Vary the sound slightly based on whether it's our turn
      if (isInteractive) {
        playClickSound();
      } else {
        // Just a subtle tap if clicking around when it's not our turn
        playSwipeSound(); 
      }
    }
  }

  return (
    <div 
      className={`interactive-game-wrapper ${isInteractive ? "is-my-turn" : ""}`}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <div className="interactive-game-ambient-light" aria-hidden="true" />
      <div className="interactive-game-content">
        {children}
      </div>
    </div>
  );
}
