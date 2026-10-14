import { cn } from "@/lib/utils";

/**
 * A bordered surface. The app's content sits on cards the way a map legend sits
 * on the map — squared corners, hairline rule, no shadow, so nothing floats.
 */
export function Panel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("border border-hairline bg-surface p-6", className)}
      {...props}
    />
  );
}

/**
 * A short caption above a panel's content. Set in the signage face, because on
 * a wayfinding map the label naming a thing is typographically distinct from the
 * thing itself.
 */
export function PanelLabel({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return <p className={cn("label text-muted", className)} {...props} />;
}

export function PanelTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "font-heading text-lg font-bold tracking-tight text-ink",
        className,
      )}
      {...props}
    />
  );
}

/**
 * An inline notice. `tone` is semantic, never decorative: `caution` means the
 * user must do something, `signal` marks a found path, `conduit` marks a role.
 */
export function Notice({
  tone = "caution",
  className,
  ...props
}: React.ComponentProps<"div"> & { tone?: "caution" | "signal" | "conduit" }) {
  const tones = {
    caution: "border-caution/30 bg-caution/[0.06] text-ink-soft",
    signal: "border-signal/30 bg-signal-soft/60 text-ink-soft",
    conduit: "border-conduit/30 bg-conduit-soft/60 text-ink-soft",
  } as const;

  return (
    <div
      className={cn("border p-4 text-sm leading-relaxed", tones[tone], className)}
      {...props}
    />
  );
}
