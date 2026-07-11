import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GameDefinition } from "../../shared/types";
import { GameBoxObject, type GameBoxState, type GamePlacementSource } from "./GameBoxObject";

type DragPosition = {
  x: number;
  y: number;
};

type GameShelfViewportProps = {
  games: GameDefinition[];
  playerCount: number;
  isHost: boolean;
  selectedGameId: string | null;
  getBoxState: (game: GameDefinition) => GameBoxState;
  isGameAvailable: (game: GameDefinition) => boolean;
  getDragPosition: (game: GameDefinition) => DragPosition | null;
  onPreview: (game: GameDefinition) => void;
  onPreviewEnd: (game: GameDefinition) => void;
  onPlace: (game: GameDefinition, source: GamePlacementSource) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

const playerCountTabs = [1, 2, 3, 4];

function pageSizeForViewport() {
  if (typeof window === "undefined") {
    return 8;
  }
  if (window.matchMedia("(max-width: 760px)").matches) {
    return 4;
  }
  if (window.matchMedia("(max-width: 980px)").matches) {
    return 6;
  }
  return 10;
}

export function GameShelfViewport({
  games,
  playerCount,
  isHost,
  selectedGameId,
  getBoxState,
  isGameAvailable,
  getDragPosition,
  onPreview,
  onPreviewEnd,
  onPlace,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: GameShelfViewportProps) {
  const [activePlayerCount, setActivePlayerCount] = useState(() => Math.min(4, Math.max(1, playerCount || 1)));
  const [pageSize, setPageSize] = useState(pageSizeForViewport);
  const [pageIndex, setPageIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setActivePlayerCount(Math.min(4, Math.max(1, playerCount || 1)));
  }, [playerCount]);

  useEffect(() => {
    const updatePageSize = () => setPageSize(pageSizeForViewport());
    window.addEventListener("resize", updatePageSize);
    return () => window.removeEventListener("resize", updatePageSize);
  }, []);

  const tabItems = useMemo(
    () =>
      playerCountTabs.map((count) => ({
        count,
        games: games.filter((game) => game.allowedPlayerCounts.includes(count))
      })),
    [games]
  );
  const activeGames = useMemo(
    () => games.filter((game) => game.allowedPlayerCounts.includes(activePlayerCount)),
    [activePlayerCount, games]
  );
  const pageCount = Math.max(1, Math.ceil(activeGames.length / pageSize));
  const visibleGames = activeGames.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const activeTabId = `game-shelf-tab-${activePlayerCount}`;

  useEffect(() => {
    setPageIndex(0);
  }, [activePlayerCount]);

  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  function selectPlayerCount(count: number) {
    setActivePlayerCount(count);
    setPageIndex(0);
  }

  function changePage(nextPage: number) {
    setPageIndex(Math.min(pageCount - 1, Math.max(0, nextPage)));
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % playerCountTabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + playerCountTabs.length) % playerCountTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = playerCountTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextCount = playerCountTabs[nextIndex];
    selectPlayerCount(nextCount);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className="game-shelf-viewport" aria-labelledby="game-shelf-title">
      <div className="game-shelf-plaque">
        <div>
          <h3 id="game-shelf-title">게임 고르기</h3>
          <span>{activePlayerCount}명용 {activeGames.length}개</span>
        </div>
        {pageCount > 1 ? (
          <nav className="game-shelf-compact-nav" aria-label="게임 목록 빠른 이동">
            <button type="button" onClick={() => changePage(pageIndex - 1)} disabled={pageIndex === 0} aria-label="이전 게임 목록">
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => changePage(pageIndex + 1)} disabled={pageIndex === pageCount - 1} aria-label="다음 게임 목록">
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </nav>
        ) : null}
        <span className="game-shelf-page-readout" aria-live="polite">{pageIndex + 1} / {pageCount}</span>
      </div>

      <div className="game-shelf-player-tabs" role="tablist" aria-label="인원수별 게임 목록">
        {tabItems.map((tab, index) => {
          const selected = activePlayerCount === tab.count;
          return (
            <button
              key={tab.count}
              id={`game-shelf-tab-${tab.count}`}
              className="game-shelf-player-tab"
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="game-shelf-panel"
              aria-label={`${tab.count}명, 게임 ${tab.games.length}개`}
              tabIndex={selected ? 0 : -1}
              data-selected={selected ? "true" : "false"}
              data-current={playerCount === tab.count ? "true" : "false"}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              onClick={() => selectPlayerCount(tab.count)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{tab.count}명</span>
              <small>{tab.games.length}</small>
            </button>
          );
        })}
      </div>

      <div
        id="game-shelf-panel"
        className="game-shelf-panel"
        role="tabpanel"
        aria-labelledby={activeTabId}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "PageDown" || event.key === "ArrowRight") {
            event.preventDefault();
            changePage(pageIndex + 1);
          } else if (event.key === "PageUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            changePage(pageIndex - 1);
          }
        }}
      >
        <div className="game-shelf-page" key={`${activePlayerCount}-${pageIndex}`}>
          <div className="game-shelf-grid" role="list">
          {visibleGames.map((game) => {
            const available = isGameAvailable(game);
            return (
              <div className="game-shelf-slot" key={game.id} role="listitem">
                <GameBoxObject
                  game={game}
                  state={getBoxState(game)}
                  available={available}
                  selected={selectedGameId === game.id}
                  isHost={isHost}
                  playerCount={playerCount}
                  dragPosition={getDragPosition(game)}
                  onPreview={onPreview}
                  onPreviewEnd={onPreviewEnd}
                  onPlace={onPlace}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                />
              </div>
            );
          })}
          </div>
        </div>

        {pageCount > 1 ? (
          <nav className="game-shelf-pagination" aria-label="게임 목록 페이지">
            <button type="button" onClick={() => changePage(pageIndex - 1)} disabled={pageIndex === 0} aria-label="이전 게임 목록">
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <div className="game-shelf-page-dots" aria-hidden="true">
              {Array.from({ length: pageCount }, (_, index) => (
                <span key={index} data-current={index === pageIndex ? "true" : "false"} />
              ))}
            </div>
            <button type="button" onClick={() => changePage(pageIndex + 1)} disabled={pageIndex === pageCount - 1} aria-label="다음 게임 목록">
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </nav>
        ) : null}
      </div>
    </section>
  );
}

export default GameShelfViewport;
