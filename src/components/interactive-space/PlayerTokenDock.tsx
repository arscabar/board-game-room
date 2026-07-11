import { ChevronDown, DoorOpen, Shuffle, Trash2 } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState
} from "react";
import type { PlayerAvatar } from "../../shared/types";
import { playClickSound } from "../../utils/haptics";

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
  { id: "crown", label: "왕관" },
  { id: "glasses", label: "안경" },
  { id: "cap", label: "모자" },
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

const fallbackAvatar = {
  body: "pawn",
  face: "smile",
  accessory: "crown",
  palette: "teal"
} satisfies PlayerAvatar;

export type PlayerTokenDockProps = {
  name: string;
  avatar: PlayerAvatar;
  canCreate: boolean;
  hasSavedRoom: boolean;
  onNameChange: (value: string) => void;
  onAvatarChange: (value: PlayerAvatar) => void;
  onResumeSavedRoom: () => void;
  onResetLocalIdentity: () => void;
  onTokenDrop: (clientX: number, clientY: number) => boolean;
  onDragStateChange: (isDragging: boolean) => void;
};

type DragState = {
  x: number;
  y: number;
  state: "docked" | "lifted" | "dragging" | "over-empty" | "placing";
};

type ActiveDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function updateAvatarPart<T extends keyof PlayerAvatar>(avatar: PlayerAvatar, key: T, value: PlayerAvatar[T]) {
  return { ...avatar, [key]: value };
}

function normalizeTokenAvatar(value: PlayerAvatar | null | undefined) {
  if (!value || typeof value !== "object") {
    return fallbackAvatar;
  }
  return {
    body: avatarBodies.some((item) => item.id === value.body) ? value.body : fallbackAvatar.body,
    face: avatarFaces.some((item) => item.id === value.face) ? value.face : fallbackAvatar.face,
    accessory: avatarAccessories.some((item) => item.id === value.accessory) ? value.accessory : fallbackAvatar.accessory,
    palette: avatarPalettes.some((item) => item.id === value.palette) ? value.palette : fallbackAvatar.palette
  } satisfies PlayerAvatar;
}

function nextAvatar(avatar: PlayerAvatar) {
  const safeAvatar = normalizeTokenAvatar(avatar);
  const nextBody = avatarBodies[(avatarBodies.findIndex((item) => item.id === safeAvatar.body) + 1) % avatarBodies.length]?.id ?? "pawn";
  const nextFace = avatarFaces[(avatarFaces.findIndex((item) => item.id === safeAvatar.face) + 1) % avatarFaces.length]?.id ?? "smile";
  const nextAccessory =
    avatarAccessories[(avatarAccessories.findIndex((item) => item.id === safeAvatar.accessory) + 1) % avatarAccessories.length]?.id ?? "none";
  const nextPalette =
    avatarPalettes[(avatarPalettes.findIndex((item) => item.id === safeAvatar.palette) + 1) % avatarPalettes.length]?.id ?? "teal";

  return {
    body: nextBody,
    face: nextFace,
    accessory: nextAccessory,
    palette: nextPalette
  } satisfies PlayerAvatar;
}

export function avatarCssVars(avatar: PlayerAvatar | null | undefined) {
  const safeAvatar = normalizeTokenAvatar(avatar);
  const palette = avatarPalettes.find((item) => item.id === safeAvatar.palette) ?? avatarPalettes[0];
  return {
    "--player-token-base": palette.base,
    "--player-token-light": palette.light,
    "--player-token-dark": palette.dark,
    "--player-token-accent": palette.accent
  } as CSSProperties;
}

export function PlayerTokenPawn({
  avatar,
  label,
  className = ""
}: {
  avatar?: PlayerAvatar | null;
  label?: string;
  className?: string;
}) {
  const safeAvatar = normalizeTokenAvatar(avatar);
  const accessibleProps = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };

  return (
    <span
      className={cx("player-token-pawn", `player-token-body-${safeAvatar.body}`, className)}
      style={avatarCssVars(safeAvatar)}
      {...accessibleProps}
    >
      <span className="player-token-shadow" aria-hidden="true" />
      <span className="player-token-body" aria-hidden="true">
        <span className={cx("player-token-face", `player-token-face-${safeAvatar.face}`)} />
        {safeAvatar.accessory !== "none" ? (
          <span className={cx("player-token-accessory", `player-token-accessory-${safeAvatar.accessory}`)} />
        ) : null}
      </span>
    </span>
  );
}

export function PlayerTokenMark({ avatar }: { avatar: PlayerAvatar }) {
  return <PlayerTokenPawn avatar={avatar} />;
}

function isOverDropZone(clientX: number, clientY: number) {
  if (typeof document === "undefined") {
    return false;
  }

  return document
    .elementsFromPoint(clientX, clientY)
    .some((element) => Boolean(element.closest(".cafe-table-object")));
}

export function PlayerTokenDock({
  name,
  avatar,
  canCreate,
  hasSavedRoom,
  onNameChange,
  onAvatarChange,
  onResumeSavedRoom,
  onResetLocalIdentity,
  onTokenDrop,
  onDragStateChange
}: PlayerTokenDockProps) {
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [drag, setDrag] = useState<DragState>({ x: 0, y: 0, state: "docked" });

  function resetDrag() {
    setDrag({ x: 0, y: 0, state: "docked" });
  }

  function handleTokenPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!canCreate) {
      return;
    }
    
    playClickSound();

    event.currentTarget.setPointerCapture(event.pointerId);
    activeDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    setDrag({ x: 0, y: 0, state: "lifted" });
    onDragStateChange(true);
  }

  function handleTokenPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }

    const x = event.clientX - activeDrag.startX;
    const y = event.clientY - activeDrag.startY;
    const moved = activeDrag.moved || Math.hypot(x, y) > 7;
    activeDrag.moved = moved;
    setDrag({
      x,
      y,
      state: moved ? (isOverDropZone(event.clientX, event.clientY) ? "over-empty" : "dragging") : "lifted"
    });
  }

  function handleTokenPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }

    activeDragRef.current = null;
    onDragStateChange(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!activeDrag.moved) {
      setExpanded((current) => !current);
      resetDrag();
      return;
    }

    if (onTokenDrop(event.clientX, event.clientY)) {
      setDrag({ x: 0, y: 0, state: "placing" });
      window.setTimeout(resetDrag, 280);
      return;
    }

    resetDrag();
  }

  function handleTokenPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }

    activeDragRef.current = null;
    onDragStateChange(false);
    resetDrag();
  }

  return (
    <aside className="player-token-dock" data-expanded={expanded ? "true" : "false"} data-token-state={drag.state} aria-label="내 말">
      <form className="player-token-form" onSubmit={(event) => event.preventDefault()}>
        <div className="player-token-identity-row">
          <button
            className="player-token-handle"
            type="button"
            style={
              {
                "--player-token-dx": `${drag.x}px`,
                "--player-token-dy": `${drag.y}px`
              } as CSSProperties
            }
            onPointerDown={handleTokenPointerDown}
            onPointerMove={handleTokenPointerMove}
            onPointerUp={handleTokenPointerUp}
            onPointerCancel={handleTokenPointerCancel}
            aria-label="내 말, 빈 테이블에 놓거나 설정 열기"
          >
            <PlayerTokenPawn avatar={avatar} label="내 말" />
          </button>

          <label className="player-token-name-field" htmlFor="cafe-player-name">
            <span>플레이어 이름</span>
            <input
              id="cafe-player-name"
              value={name}
              maxLength={16}
              onChange={(event) => onNameChange(event.currentTarget.value)}
              aria-label="플레이어 이름"
            />
          </label>

          {hasSavedRoom ? (
            <button className="player-token-icon-button player-token-resume-button" type="button" onClick={onResumeSavedRoom} title="이전 테이블 복귀" aria-label="이전 테이블 복귀">
              <DoorOpen size={17} aria-hidden="true" />
            </button>
          ) : null}

          <button
            className="player-token-icon-button"
            type="button"
            onClick={() => { playClickSound(); setExpanded((current) => !current); }}
            aria-expanded={expanded}
            aria-controls="player-token-customizer"
            aria-label="말 설정"
            title="말 설정"
          >
            <ChevronDown size={17} aria-hidden="true" />
          </button>
        </div>

        {expanded ? (
          <div className="player-token-customizer" id="player-token-customizer">
            <header className="player-token-customizer-header">
              <strong>말 꾸미기</strong>
              <button className="player-token-soft-button" type="button" onClick={() => onAvatarChange(nextAvatar(avatar))}>
                <Shuffle size={15} aria-hidden="true" />
                무작위 조합
              </button>
            </header>

            <fieldset className="player-token-option-group">
              <legend>몸체</legend>
              <div className="player-token-control-row">
              {avatarBodies.map((body) => (
                <button
                  className={cx("player-token-chip", avatar.body === body.id && "player-token-chip-selected")}
                  key={body.id}
                  type="button"
                  onClick={() => { playClickSound(); onAvatarChange(updateAvatarPart(avatar, "body", body.id)); }}
                >
                  {body.label}
                </button>
              ))}
              </div>
            </fieldset>

            <fieldset className="player-token-option-group">
              <legend>표정</legend>
              <div className="player-token-control-row">
              {avatarFaces.map((face) => (
                <button
                  className={cx("player-token-chip", avatar.face === face.id && "player-token-chip-selected")}
                  key={face.id}
                  type="button"
                  onClick={() => onAvatarChange(updateAvatarPart(avatar, "face", face.id))}
                >
                  {face.label}
                </button>
              ))}
              </div>
            </fieldset>

            <fieldset className="player-token-option-group">
              <legend>장식</legend>
              <div className="player-token-control-row">
              {avatarAccessories.map((accessory) => (
                <button
                  className={cx("player-token-chip", avatar.accessory === accessory.id && "player-token-chip-selected")}
                  key={accessory.id}
                  type="button"
                  onClick={() => onAvatarChange(updateAvatarPart(avatar, "accessory", accessory.id))}
                >
                  {accessory.label}
                </button>
              ))}
              </div>
            </fieldset>

            <fieldset className="player-token-option-group player-token-color-group">
              <legend>색상</legend>
              <div className="player-token-swatch-row">
                {avatarPalettes.map((palette) => (
                  <button
                    className={cx("player-token-swatch", avatar.palette === palette.id && "player-token-swatch-selected")}
                    key={palette.id}
                    type="button"
                    style={
                      {
                        "--player-token-base": palette.base,
                        "--player-token-light": palette.light,
                        "--player-token-dark": palette.dark
                      } as CSSProperties
                    }
                    onClick={() => onAvatarChange(updateAvatarPart(avatar, "palette", palette.id))}
                    aria-label={palette.label}
                  />
                ))}
              </div>
            </fieldset>

            <div className="player-token-action-row">
              <button className="player-token-soft-button player-token-reset-button" type="button" onClick={onResetLocalIdentity}>
                <Trash2 size={15} aria-hidden="true" />
                새 손님으로 시작
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </aside>
  );
}

export default PlayerTokenDock;
