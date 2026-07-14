import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type BoardTone = "primary" | "secondary" | "danger";

function toneClass(tone: BoardTone) {
  if (tone === "primary") return "primary-button";
  if (tone === "danger") return "secondary-button danger";
  return "secondary-button";
}

type BoardButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: BoardTone;
  variant?: "surface" | "solid" | "soft" | "outline" | "ghost";
  radius?: "none" | "small" | "medium" | "large" | "full";
};

type BoardCardProps = HTMLAttributes<HTMLDivElement> & {
  size?: "1" | "2" | "3" | "4" | "5";
  variant?: "surface" | "classic" | "ghost";
};

export function BoardButton({ className, tone = "secondary", variant = "surface", radius = "small", disabled, ...props }: BoardButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      data-disabled={disabled ? "" : undefined}
      data-radius={radius}
      data-variant={variant}
      className={cx("rt-reset", "rt-BaseButton", "rt-Button", "board-sdk-button", toneClass(tone), className)}
    />
  );
}

export function BoardIconButton({
  className,
  tone = "secondary",
  variant = "surface",
  radius = "small",
  disabled,
  ...props
}: BoardButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      data-disabled={disabled ? "" : undefined}
      data-radius={radius}
      data-variant={variant}
      className={cx("rt-reset", "rt-BaseButton", "rt-IconButton", "board-sdk-icon-button", toneClass(tone), tone === "primary" && "strong", className)}
    />
  );
}

export function BoardCard({ className, size = "1", variant = "surface", ...props }: BoardCardProps) {
  return <div {...props} data-size={size} data-variant={variant} className={cx("rt-BaseCard", "rt-Card", "board-sdk-card", className)} />;
}
