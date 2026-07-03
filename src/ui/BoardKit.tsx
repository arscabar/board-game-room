import { Button, Card, IconButton, type ButtonProps, type CardProps, type IconButtonProps } from "@radix-ui/themes";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type BoardTone = "primary" | "secondary" | "danger";

function toneClass(tone: BoardTone) {
  if (tone === "primary") return "primary-button";
  if (tone === "danger") return "secondary-button danger";
  return "secondary-button";
}

export function BoardButton({ className, tone = "secondary", variant = "surface", radius = "small", ...props }: ButtonProps & { tone?: BoardTone }) {
  return (
    <Button
      {...props}
      radius={radius}
      variant={variant}
      className={cx("board-sdk-button", toneClass(tone), className)}
    />
  );
}

export function BoardIconButton({
  className,
  tone = "secondary",
  variant = "surface",
  radius = "small",
  ...props
}: IconButtonProps & { tone?: BoardTone }) {
  return (
    <IconButton
      {...props}
      radius={radius}
      variant={variant}
      className={cx("board-sdk-icon-button", toneClass(tone), tone === "primary" && "strong", className)}
    />
  );
}

export function BoardCard({ className, size = "1", variant = "surface", ...props }: CardProps) {
  return <Card {...props} size={size} variant={variant} className={cx("board-sdk-card", className)} />;
}
