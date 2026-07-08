import { CheckCircle2, Hand, LockKeyhole } from "lucide-react";
import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { formatAllowedPlayers, gameAvailabilityLabel } from "../../shared/eligibility";
import type { GameDefinition } from "../../shared/types";
import type { GameBoxState, PlacementSource } from "./interactive-space.types";

export type { GameBoxState } from "./interactive-space.types";
export type GamePlacementSource = PlacementSource;

type DragPosition = {
  x: number;
  y: number;
};

const rasterCoverIds = new Set([
  "abalone-classic",
  "blokus",
  "davinci-code-plus",
  "ghosts",
  "guryongtu",
  "hangman-board-game",
  "qawale",
  "quoridor",
  "yacht-dice",
  "yinsh"
]);

function coverSrc(game: GameDefinition) {
  return `/board-assets/game-covers/${game.id}.${rasterCoverIds.has(game.id) ? "png" : "svg"}`;
}

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

  return <img className={className} src={coverSrc(game)} alt={`${game.title} 게임 상자`} draggable={false} onError={() => setFailed(true)} />;
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
  const disabled = !available || !isHost;
  const stateLabel = selected
    ? "선택됨"
    : !available
      ? gameAvailabilityLabel(game, playerCount)
      : isHost
        ? "테이블에 놓기"
        : "방장 선택 대기";
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
      style={rootStyle}
    >
      <button
        type="button"
        className="game-box-main"
        disabled={disabled}
        aria-pressed={selected}
        aria-label={`${game.title}, ${formatAllowedPlayers(game)}, ${stateLabel}`}
        onPointerDown={(event) => onPointerDown(event, game)}
        onPointerMove={(event) => onPointerMove(event, game)}
        onPointerUp={(event) => onPointerUp(event, game)}
        onPointerCancel={onPointerCancel}
        onFocus={() => onPreview(game)}
        onBlur={() => onPreviewEnd(game)}
        onClick={() => {
          if (!disabled) {
            onPlace(game, "tap");
          }
        }}
      >
        <span className="game-box-lid">
          <GameCover game={game} className="game-cover-art" />
        </span>
        <span className="game-box-spine" aria-hidden="true" />
        <span className="game-box-label">
          <strong>{game.title}</strong>
          <small>{formatAllowedPlayers(game)}</small>
        </span>
        <span className="game-box-state">
          {selected ? <CheckCircle2 size={15} aria-hidden="true" /> : available ? <Hand size={15} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}
        </span>
        <span className="game-box-action">{stateLabel}</span>
      </button>
    </div>
  );
}
