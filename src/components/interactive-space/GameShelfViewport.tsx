import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
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

type PlayerCountFilter = "all" | number;

const playerCountTabs: Array<{ value: PlayerCountFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: 1, label: "1명" },
  { value: 2, label: "2명" },
  { value: 3, label: "3명" },
  { value: 4, label: "4명" }
];

function gamesForFilter(games: GameDefinition[], filter: PlayerCountFilter) {
  if (filter === "all") {
    return games;
  }

  const playerCount = filter;
  return games.filter((game) => game.allowedPlayerCounts.includes(playerCount));
}

function pageSizeForViewport(gameCount: number) {
  if (typeof window === "undefined") {
    return 8;
  }
  if (window.matchMedia("(max-width: 760px)").matches) {
    return Math.max(1, gameCount);
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
  const [activeFilter, setActiveFilter] = useState<PlayerCountFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(() => pageSizeForViewport(games.length));
  const [pageIndex, setPageIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const updatePageSize = () => setPageSize(pageSizeForViewport(games.length));
    window.addEventListener("resize", updatePageSize);
    return () => window.removeEventListener("resize", updatePageSize);
  }, [games.length]);

  const tabItems = useMemo(
    () =>
      playerCountTabs.map((tab) => ({
        ...tab,
        games: gamesForFilter(games, tab.value)
      })),
    [games]
  );
  const activeGames = useMemo(() => {
    const filteredGames = gamesForFilter(games, activeFilter);
    const query = searchQuery.trim().toLocaleLowerCase("ko-KR");
    if (!query) return filteredGames;

    return filteredGames.filter((game) =>
      [game.title, game.original, game.genre, game.summary, game.id, game.table.kind, ...game.components]
        .join(" ")
        .toLocaleLowerCase("ko-KR")
        .includes(query)
    );
  }, [activeFilter, games, searchQuery]);
  const pageCount = Math.max(1, Math.ceil(activeGames.length / pageSize));
  const visibleGames = activeGames.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const activeTabId = `game-shelf-tab-${activeFilter}`;

  useEffect(() => {
    setPageIndex(0);
  }, [activeFilter, searchQuery]);

  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  function selectFilter(filter: PlayerCountFilter) {
    setActiveFilter(filter);
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
    const nextFilter = playerCountTabs[nextIndex].value;
    selectFilter(nextFilter);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section
      className="game-shelf-viewport"
      aria-labelledby="game-shelf-title"
      data-searching={searchQuery.trim() ? "true" : "false"}
    >
      <div className="game-shelf-plaque">
        <div>
          <h3 id="game-shelf-title">게임 둘러보기</h3>
          <span>
            {searchQuery.trim()
              ? `검색 결과 ${activeGames.length}개`
              : activeFilter === "all"
                ? `전체 게임 ${activeGames.length}개`
                : `${activeFilter}명용 ${activeGames.length}개`}
          </span>
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
        {pageCount > 1 ? <span className="game-shelf-page-readout" aria-live="polite">{pageIndex + 1} / {pageCount}</span> : null}
      </div>

      <div className="game-shelf-player-tabs" role="tablist" aria-label="인원수별 게임 목록">
        {tabItems.map((tab, index) => {
          const selected = activeFilter === tab.value;
          return (
            <button
              key={tab.value}
              id={`game-shelf-tab-${tab.value}`}
              className="game-shelf-player-tab"
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="game-shelf-panel"
              aria-label={tab.value === "all" ? `전체 게임 ${tab.games.length}개` : `${tab.value}명, 게임 ${tab.games.length}개`}
              tabIndex={selected ? 0 : -1}
              data-selected={selected ? "true" : "false"}
              data-current={tab.value !== "all" && playerCount === tab.value ? "true" : "false"}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              onClick={() => selectFilter(tab.value)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{tab.label}</span>
              <small>{tab.games.length}</small>
            </button>
          );
        })}
      </div>

      <div className="game-shelf-tools">
        <div className="game-shelf-search">
          <Search size={17} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="game-shelf-search-input">게임 검색</label>
          <input
            id="game-shelf-search-input"
            type="search"
            value={searchQuery}
            placeholder="제목·장르로 게임 찾기"
            autoComplete="off"
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchQuery) {
                event.preventDefault();
                setSearchQuery("");
              }
            }}
          />
          {searchQuery ? (
            <button type="button" onClick={() => setSearchQuery("")} aria-label="게임 검색어 지우기">
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <span className="game-shelf-result-count" aria-live="polite">
          {searchQuery.trim() ? `${activeGames.length}개 찾음` : `${activeGames.length}개 표시`}
        </span>
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
        <div className="game-shelf-page" key={`${activeFilter}-${searchQuery}-${pageIndex}`}>
          <div className="game-shelf-grid" role="list" data-result-count={visibleGames.length}>
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
          {activeGames.length === 0 ? (
            <div className="game-shelf-empty" role="status">
              <Search size={22} aria-hidden="true" />
              <strong>조건에 맞는 게임이 없습니다.</strong>
              <span>검색어를 줄이거나 다른 인원 탭을 선택해보세요.</span>
              <button type="button" onClick={() => setSearchQuery("")}>검색 초기화</button>
            </div>
          ) : null}
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
