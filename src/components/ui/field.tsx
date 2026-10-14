import { cn } from "@/lib/utils";

/**
 * Form primitives.
 *
 * Inputs are drawn as inset fields with a hairline border and no radius to
 * speak of, matching the panels. Focus is handled by the global
 * `:focus-visible` ring in globals.css, so nothing here removes an outline.
 */

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("label block text-ink-soft", className)}
      {...props}
    />
  );
}

/** The same treatment as `Label`, for the heading of a group of checkboxes. */
export function Legend({ className, ...props }: React.ComponentProps<"legend">) {
  return <legend className={cn("label text-ink-soft", className)} {...props} />;
}

/** Explanatory text under a label. One job: say what a good answer looks like. */
export function Hint({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1.5 text-sm text-muted", className)} {...props} />;
}

const fieldClasses =
  "w-full rounded-[3px] border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/70 hover:border-muted focus:border-ink";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClasses, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldClasses, "min-h-20 resize-y leading-relaxed", className)}
      {...props}
    />
  );
}

/**
 * A checkbox with its label, as one target. Uses `accent-color` rather than a
 * custom-drawn box so it stays a real checkbox for assistive tech and for the
 * platform's own focus and touch behaviour.
 */
export function Checkbox({
  label,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft select-none hover:text-ink",
        className,
      )}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-[var(--color-signal)]"
        {...props}
      />
      {label}
    </label>
  );
}
