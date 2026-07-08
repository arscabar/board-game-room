import { DoorOpen, RefreshCw, Shuffle, Trash2, UserRound, Users } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { PlayerAvatar } from "../../shared/types";
import "./interactive-home-scene.css";

const avatarBodies: Array<{ id: PlayerAvatar["body"]; label: string }> = [
  { id: "pawn", label: "말" },
  { id: "round", label: "원" },
  { id: "bot", label: "봇" },
  { id: "crest", label: "문장" }
];

const avatarFaces: Array<{ id: PlayerAvatar["face"]; label: string }> = [
  { id: "smile", label: "웃음" },
  { id: "focus", label: "집중" },
  { id: "wink", label: "윙크" },
  { id: "calm", label: "차분" }
];

const avatarAccessories: Array<{ id: PlayerAvatar["accessory"]; label: string }> = [
  { id: "none", label: "없음" },
  { id: "crown", label: "관" },
  { id: "glasses", label: "안경" },
  { id: "cap", label: "캡" },
  { id: "spark", label: "별" }
];

const avatarPalettes = [
  { id: "teal", label: "청록", base: "#0c8b6c", light: "#72dec1", dark: "#05352e", accent: "#f1d58f" },
  { id: "amber", label: "황금", base: "#c88b25", light: "#ffe09a", dark: "#4a270b", accent: "#1d7b68" },
  { id: "blue", label: "청색", base: "#2364aa", light: "#9bc3ff", dark: "#0d2442", accent: "#e5c06a" },
  { id: "rose", label: "장미", base: "#b33d55", light: "#ff9cad", dark: "#43141f", accent: "#f0d486" },
  { id: "violet", label: "보라", base: "#7450b8", light: "#c3a8ff", dark: "#28173e", accent: "#e5c06a" },
  { id: "ivory", label: "상아", base: "#efe0b6", light: "#fff7dc", dark: "#6b5430", accent: "#0a7b64" }
] satisfies Array<{ id: PlayerAvatar["palette"]; label: string; base: string; light: string; dark: string; accent: string }>;

type InteractiveHomeSceneProps = {
  name: string;
  avatar: PlayerAvatar;
  notice: string;
  connection: "connecting" | "connected" | "offline";
  lastRoomCode: string;
  rooms: InteractiveHomeRoom[];
  roomsLoading: boolean;
  onNameChange: (value: string) => void;
  onAvatarChange: (value: PlayerAvatar) => void;
  onCreateRoom: (event: FormEvent) => void;
  onJoinListedRoom: (code: string) => void;
  onRefreshRooms: () => void;
  onResumeSavedRoom: () => void;
  onResetLocalIdentity: () => void;
};

export type InteractiveHomeRoom = {
  code: string;
  playerCount: number;
  maxPlayers: number;
  status: "lobby" | "playing";
  selectedGameId: string | null;
  selectedGameTitle: string | null;
  hostName: string | null;
  hostAvatar: PlayerAvatar | null;
  createdAt: number;
  canJoin: boolean;
};

type PreventableEvent = {
  preventDefault: () => void;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatRoomTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function avatarCssVars(avatar: PlayerAvatar) {
  const palette = avatarPalettes.find((item) => item.id === avatar.palette) ?? avatarPalettes[0];
  return {
    "--avatar-base": palette.base,
    "--avatar-light": palette.light,
    "--avatar-dark": palette.dark,
    "--avatar-accent": palette.accent
  } as CSSProperties;
}

function nextAvatar(avatar: PlayerAvatar) {
  const nextBody = avatarBodies[(avatarBodies.findIndex((item) => item.id === avatar.body) + 1) % avatarBodies.length]?.id ?? "pawn";
  const nextFace = avatarFaces[(avatarFaces.findIndex((item) => item.id === avatar.face) + 1) % avatarFaces.length]?.id ?? "smile";
  const nextAccessory =
    avatarAccessories[(avatarAccessories.findIndex((item) => item.id === avatar.accessory) + 1) % avatarAccessories.length]?.id ?? "none";
  const nextPalette =
    avatarPalettes[(avatarPalettes.findIndex((item) => item.id === avatar.palette) + 1) % avatarPalettes.length]?.id ?? "teal";

  return {
    body: nextBody,
    face: nextFace,
    accessory: nextAccessory,
    palette: nextPalette
  } satisfies PlayerAvatar;
}

function updateAvatarPart<T extends keyof PlayerAvatar>(avatar: PlayerAvatar, key: T, value: PlayerAvatar[T]) {
  return { ...avatar, [key]: value };
}

function PlayerToken({
  avatar,
  label,
  className = ""
}: {
  avatar: PlayerAvatar;
  label?: string;
  className?: string;
}) {
  const accessibleProps = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };

  return (
    <span className={cx("ir-player-token", `ir-avatar-${avatar.body}`, className)} style={avatarCssVars(avatar)} {...accessibleProps}>
      <span className="ir-token-shadow" aria-hidden="true" />
      <span className="ir-token-body" aria-hidden="true">
        <span className={`ir-token-face ir-face-${avatar.face}`} />
        {avatar.accessory !== "none" ? <span className={`ir-token-accessory ir-accessory-${avatar.accessory}`} /> : null}
      </span>
    </span>
  );
}

function AvatarBench({
  avatar,
  onChange,
  tokenDragStyle,
  tokenState,
  onTokenPointerDown,
  onTokenPointerMove,
  onTokenPointerUp,
  onTokenPointerCancel
}: {
  avatar: PlayerAvatar;
  onChange: (value: PlayerAvatar) => void;
  tokenDragStyle: CSSProperties;
  tokenState: string;
  onTokenPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTokenPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTokenPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTokenPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="ir-avatar-bench" aria-label="플레이어 아이콘 설정">
      <div className="ir-avatar-preview" data-state={tokenState}>
        <button
          className="ir-player-token-handle"
          type="button"
          style={tokenDragStyle}
          onPointerDown={onTokenPointerDown}
          onPointerMove={onTokenPointerMove}
          onPointerUp={onTokenPointerUp}
          onPointerCancel={onTokenPointerCancel}
          aria-label="내 말, 빈 테이블에 놓으면 방 만들기"
        >
          <PlayerToken avatar={avatar} label="내 아이콘" />
        </button>
        <button type="button" className="ir-mini-action" onClick={() => onChange(nextAvatar(avatar))}>
          <Shuffle size={14} aria-hidden="true" />
          조합
        </button>
      </div>
      <div className="ir-avatar-controls">
        <div className="ir-chip-row" aria-label="몸 모양">
          {avatarBodies.map((body) => (
            <button
              key={body.id}
              type="button"
              className={cx("ir-chip-button", avatar.body === body.id && "ir-is-selected")}
              onClick={() => onChange(updateAvatarPart(avatar, "body", body.id))}
            >
              {body.label}
            </button>
          ))}
        </div>
        <div className="ir-chip-row" aria-label="표정">
          {avatarFaces.map((face) => (
            <button
              key={face.id}
              type="button"
              className={cx("ir-chip-button", avatar.face === face.id && "ir-is-selected")}
              onClick={() => onChange(updateAvatarPart(avatar, "face", face.id))}
            >
              {face.label}
            </button>
          ))}
        </div>
        <div className="ir-swatch-row" aria-label="색상">
          {avatarPalettes.map((palette) => (
            <button
              key={palette.id}
              type="button"
              className={cx("ir-swatch-button", avatar.palette === palette.id && "ir-is-selected")}
              style={
                {
                  "--avatar-base": palette.base,
                  "--avatar-light": palette.light,
                  "--avatar-dark": palette.dark
                } as CSSProperties
              }
              onClick={() => onChange(updateAvatarPart(avatar, "palette", palette.id))}
              aria-label={palette.label}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function InteractiveHomeScene({
  name,
  avatar,
  notice,
  connection,
  lastRoomCode,
  rooms,
  roomsLoading,
  onNameChange,
  onAvatarChange,
  onCreateRoom,
  onJoinListedRoom,
  onRefreshRooms,
  onResumeSavedRoom,
  onResetLocalIdentity
}: InteractiveHomeSceneProps) {
  const disabled = connection !== "connected";
  const canCreate = !disabled && Boolean(name.trim());
  const savedRoom = lastRoomCode ? rooms.find((room) => room.code === lastRoomCode) ?? null : null;
  const emptyTableRef = useRef<HTMLButtonElement | null>(null);
  const tokenDragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const [focusCode, setFocusCode] = useState("");
  const [pointer, setPointer] = useState({ x: 50, y: 50 });
  const [tokenDrag, setTokenDrag] = useState({ x: 0, y: 0, state: "token-docked" });
  const focusedRoom = useMemo(
    () => rooms.find((room) => room.code === focusCode) ?? savedRoom ?? rooms[0] ?? null,
    [focusCode, rooms, savedRoom]
  );

  useEffect(() => {
    if (focusCode && !rooms.some((room) => room.code === focusCode)) {
      setFocusCode("");
    }
  }, [focusCode, rooms]);

  function movePointer(event: ReactPointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
    });
  }

  function requestCreateRoom(event: PreventableEvent) {
    event.preventDefault();
    if (!canCreate) {
      return;
    }
    setTokenDrag({ x: 0, y: 0, state: "creating-room" });
    onCreateRoom(event as unknown as FormEvent);
    window.setTimeout(() => setTokenDrag({ x: 0, y: 0, state: "token-docked" }), 240);
  }

  function roomActionLabel(room: InteractiveHomeRoom) {
    if (room.code === lastRoomCode) {
      return "복귀";
    }
    if (room.status === "playing") {
      return "게임 중";
    }
    return room.canJoin ? "입장 가능" : "만석";
  }

  function roomAriaLabel(room: InteractiveHomeRoom) {
    const host = room.hostName ?? "이름 없는 방장";
    const game = room.selectedGameTitle ?? "게임 선택 전";
    return `${host}의 방, ${room.playerCount}/${room.maxPlayers}명, ${roomActionLabel(room)}, ${game}`;
  }

  function canUseRoom(room: InteractiveHomeRoom) {
    return !disabled && Boolean(name.trim()) && (room.canJoin || room.code === lastRoomCode);
  }

  function joinRoom(room: InteractiveHomeRoom) {
    if (disabled || !name.trim()) {
      return;
    }
    if (room.code === lastRoomCode) {
      onResumeSavedRoom();
      return;
    }
    if (room.canJoin) {
      onJoinListedRoom(room.code);
    }
  }

  function focusOrJoinRoom(room: InteractiveHomeRoom) {
    const alreadyFocused = focusCode === room.code;
    setFocusCode(room.code);
    if (alreadyFocused && canUseRoom(room)) {
      joinRoom(room);
    }
  }

  function isOverEmptyTable(clientX: number, clientY: number) {
    const rect = emptyTableRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function handleTokenPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!canCreate) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    tokenDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    setTokenDrag({ x: 0, y: 0, state: "player-token-lifted" });
  }

  function handleTokenPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = tokenDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = {
      x: event.clientX - drag.startX,
      y: event.clientY - drag.startY
    };
    if (Math.abs(next.x) + Math.abs(next.y) > 6) {
      drag.moved = true;
    }
    setTokenDrag({
      ...next,
      state: isOverEmptyTable(event.clientX, event.clientY)
        ? "player-token-over-empty-table"
        : drag.moved
          ? "token-dragging"
          : "player-token-lifted"
    });
  }

  function handleTokenPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = tokenDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const droppedOnEmptyTable = isOverEmptyTable(event.clientX, event.clientY);
    tokenDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (droppedOnEmptyTable) {
      requestCreateRoom(event);
      return;
    }
    setTokenDrag({ x: 0, y: 0, state: "token-docked" });
  }

  function handleTokenPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = tokenDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    tokenDragRef.current = null;
    setTokenDrag({ x: 0, y: 0, state: "token-docked" });
  }

  return (
    <section className="ir-home-scene" data-state={tokenDrag.state} aria-labelledby="ir-home-title">
      <div className="ir-hero-table" onPointerMove={movePointer} style={{ "--ir-pointer-x": `${pointer.x}%`, "--ir-pointer-y": `${pointer.y}%` } as CSSProperties}>
        <div className="ir-table-hall">
          <div className="ir-hall-topline">
            <div>
              <span className="ir-kicker">실시간 보드게임 테이블</span>
              <h2 className="ir-hall-title" id="ir-home-title">테이블을 둘러보고 시작하세요.</h2>
            </div>
            <button className="ir-icon-action" type="button" onClick={onRefreshRooms} disabled={roomsLoading} aria-label="방 목록 갱신">
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="ir-table-grid" aria-label="방 목록">
            {roomsLoading ? (
              <div className="ir-room-table ir-room-table-loading" role="status">
                테이블을 확인하는 중
              </div>
            ) : rooms.length > 0 ? (
              rooms.map((room, index) => {
                const isSaved = room.code === lastRoomCode;
                const enabled = canUseRoom(room);
                const focused = focusedRoom?.code === room.code;
                return (
                  <button
                    key={room.code}
                    type="button"
                    className={cx("ir-room-table", focused && "ir-room-table--focused", !enabled && "ir-room-table--locked")}
                    style={{ "--ir-table-index": index } as CSSProperties}
                    onPointerEnter={() => setFocusCode(room.code)}
                    onFocus={() => setFocusCode(room.code)}
                    onClick={() => focusOrJoinRoom(room)}
                    disabled={disabled}
                    aria-disabled={!enabled}
                    aria-pressed={focused}
                    aria-label={roomAriaLabel(room)}
                  >
                    <span className="ir-room-felt">
                      {room.hostAvatar ? <PlayerToken avatar={room.hostAvatar} label={`${room.hostName ?? "방장"} 아이콘`} /> : <UserRound size={20} aria-hidden="true" />}
                      <span className="ir-room-title">{room.hostName ? `${room.hostName}의 방` : "이름 없는 방"}</span>
                      <span className="ir-room-subtitle">{room.selectedGameTitle ?? "게임 선택 전"}</span>
                      <span className="ir-room-seats" aria-hidden="true">
                        {Array.from({ length: room.maxPlayers }, (_, seatIndex) => (
                          <i key={seatIndex} className={seatIndex < room.playerCount ? "ir-seat-filled" : ""} />
                        ))}
                      </span>
                    </span>
                    <span className="ir-room-footer">
                      <strong>{room.playerCount}/{room.maxPlayers}</strong>
                      <small>{roomActionLabel(room)}</small>
                    </span>
                  </button>
                );
              })
            ) : (
              <button
                ref={emptyTableRef}
                type="button"
                className={cx("ir-empty-table ir-create-drop-zone", tokenDrag.state === "player-token-over-empty-table" && "ir-empty-table--over")}
                onClick={requestCreateRoom}
                disabled={!canCreate}
                aria-label={`빈 테이블, 내 말로 새 방 만들기, ${disabled ? "연결 필요" : "준비됨"}`}
              >
                <span className="ir-empty-table-surface">
                  <span className="ir-empty-seat ir-empty-seat--top" />
                  <span className="ir-empty-seat ir-empty-seat--right" />
                  <span className="ir-empty-seat ir-empty-seat--bottom" />
                  <span className="ir-empty-seat ir-empty-seat--left" />
                  <span className="ir-create-puck">+</span>
                </span>
                <strong>빈 테이블</strong>
                <small>{canCreate ? "눌러서 방 만들기" : "이름을 먼저 정하세요"}</small>
              </button>
            )}
          </div>
        </div>

        <aside className="ir-player-station" aria-label="플레이어 설정">
          <form className="ir-create-form" onSubmit={onCreateRoom}>
            <label className="ir-name-field" htmlFor="player-name">
              <span>플레이어</span>
              <input className="ir-name-input" id="player-name" value={name} maxLength={16} onChange={(event) => onNameChange(event.target.value)} />
            </label>
            <AvatarBench
              avatar={avatar}
              onChange={onAvatarChange}
              tokenDragStyle={
                {
                  "--ir-token-dx": `${tokenDrag.x}px`,
                  "--ir-token-dy": `${tokenDrag.y}px`
                } as CSSProperties
              }
              tokenState={tokenDrag.state}
              onTokenPointerDown={handleTokenPointerDown}
              onTokenPointerMove={handleTokenPointerMove}
              onTokenPointerUp={handleTokenPointerUp}
              onTokenPointerCancel={handleTokenPointerCancel}
            />
            <div className="ir-command-row">
              {savedRoom ? (
                <button className="ir-soft-action" type="button" onClick={onResumeSavedRoom} disabled={disabled}>
                  <DoorOpen size={16} aria-hidden="true" />
                  복귀
                </button>
              ) : null}
              <button className="ir-soft-action" type="button" onClick={onResetLocalIdentity}>
                <Trash2 size={16} aria-hidden="true" />
                새 손님
              </button>
              <button className="ir-primary-action" type="submit" disabled={!canCreate}>
                방 만들기
              </button>
            </div>
          </form>

          <div className="ir-room-spotlight" aria-live="polite">
            <Users size={17} aria-hidden="true" />
            {focusedRoom ? (
              <span>
                <strong>{focusedRoom.hostName ? `${focusedRoom.hostName}의 방` : "열린 방"}</strong>
                <small>{focusedRoom.playerCount}/{focusedRoom.maxPlayers}명 · {focusedRoom.selectedGameTitle ?? "게임 선택 전"} · {formatRoomTime(focusedRoom.createdAt)}</small>
              </span>
            ) : (
              <span>
                <strong>대기 중</strong>
                <small>첫 방을 만들면 이곳에 표시됩니다.</small>
              </span>
            )}
            {focusedRoom ? (
              <button className="ir-mini-action" type="button" onClick={() => joinRoom(focusedRoom)} disabled={!canUseRoom(focusedRoom)}>
                {focusedRoom.code === lastRoomCode ? "복귀" : focusedRoom.canJoin ? "입장" : "대기"}
              </button>
            ) : null}
          </div>
        </aside>
      </div>

      {notice ? <p className="ir-notice" role="alert">{notice}</p> : null}
    </section>
  );
}
