import { CheckCircle2, Eye, Hand } from "lucide-react";
import * as m from "motion/react-m";
import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { formatAllowedPlayers, gameAvailabilityLabel } from "../../shared/eligibility";
import { gameCoverSrc } from "../../shared/gameCover";
import type { GameDefinition } from "../../shared/types";
import type { GameBoxState, PlacementSource } from "./interactive-space.types";

export type { GameBoxState } from "./interactive-space.types";
export type GamePlacementSource = PlacementSource;

type DragPosition = {
  x: number;
  y: number;
};

export function GameCover({ game, className = "" }: { game: GameDefinition; className?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [game.id]);

  if (failed) {
    return (
      <span className={`game-cover-fallback ${className}`} role="img" aria-label={`${game.title} 게임 상자`}>
        <strong>{game.title.slice(0, 2)}</strong>
        <small>{game.table.kind}</small>
      </span>
    );
  }

  return (
    <img
      className={className}
      src={gameCoverSrc(game)}
      alt={`${game.title} 게임 상자`}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function GameBoxObject({
  game,
  state,
  available,
  selected,
  isHost,
  playerCount,
  dragPosition,
  onPreview,
  onPreviewEnd,
  onPlace,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: {
  game: GameDefinition;
  state: GameBoxState;
  available: boolean;
  selected: boolean;
  isHost: boolean;
  playerCount: number;
  dragPosition: DragPosition | null;
  onPreview: (game: GameDefinition) => void;
  onPreviewEnd: (game: GameDefinition) => void;
  onPlace: (game: GameDefinition, source: GamePlacementSource) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const canPlace = available && isHost;
  const hasCommercialCover = game.id === "blind-card-duel" || game.id === "parity-tile-duel" || game.id === "mosaic-rush";
  const stateLabel = selected
    ? "선택됨"
    : !available
      ? gameAvailabilityLabel(game, playerCount)
      : isHost
        ? "테이블에 놓기"
        : "방장 선택 대기";
  const interactionLabel = canPlace ? stateLabel : `${stateLabel}, 미리보기`;
  const rootStyle = {
    "--game-accent": game.accent,
    "--game-drag-x": `${dragPosition?.x ?? 0}px`,
    "--game-drag-y": `${dragPosition?.y ?? 0}px`
  } as CSSProperties;

  return (
    <div
      className="game-box-object"
      data-state={state}
      data-available={available ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-browse-only={canPlace ? "false" : "true"}
      data-commercial-cover={hasCommercialCover ? "true" : "false"}
      style={rootStyle}
    >
      <button
        type="button"
        className="game-box-main"
        aria-pressed={selected}
        aria-label={`${game.title}, ${formatAllowedPlayers(game)}, ${interactionLabel}`}
        onPointerDown={(event) => onPointerDown(event, game)}
        onPointerMove={(event) => onPointerMove(event, game)}
        onPointerUp={(event) => onPointerUp(event, game)}
        onPointerCancel={onPointerCancel}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse" || event.pointerType === "pen") {
            onPreview(game);
          }
        }}
        onPointerLeave={(event) => {
          if ((event.pointerType === "mouse" || event.pointerType === "pen") && event.buttons === 0) {
            onPreviewEnd(game);
          }
        }}
        onMouseEnter={() => onPreview(game)}
        onMouseLeave={() => onPreviewEnd(game)}
        onFocus={() => onPreview(game)}
        onBlur={() => onPreviewEnd(game)}
        onClick={() => {
          if (canPlace) {
            onPlace(game, "tap");
          } else {
            onPreview(game);
          }
        }}
      >
        <m.span
          className="game-box-lid"
          layoutId={`game-box-${game.id}`}
          transition={{ layout: { type: "spring", stiffness: 430, damping: 34, mass: 0.72 } }}
        >
          <GameCover game={game} className="game-cover-art" />
          {hasCommercialCover ? (
            <span className="game-cover-title-lockup" aria-hidden="true">
              <small>WEB TABLE EDITION</small>
              <strong>{game.title}</strong>
            </span>
          ) : null}
        </m.span>
        <span className="game-box-spine" aria-hidden="true" />
        <span className="game-box-label">
          <strong>{game.title}</strong>
          <small>{formatAllowedPlayers(game)}</small>
        </span>
        <span className="game-box-state">
          {selected ? <CheckCircle2 size={15} aria-hidden="true" /> : canPlace ? <Hand size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
        </span>
        <span className="game-box-action">{stateLabel}</span>
      </button>
    </div>
  );
}
