import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Shared: signage-like, tight tracking, no oversized radius — map furniture is
  // square-ish. Transitions stay short so the UI feels mechanical, not bouncy.
  "inline-flex items-center justify-center gap-2 rounded-[3px] font-medium whitespace-nowrap transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        /** Primary action. Ink-filled, the heaviest thing on the page. */
        solid: "bg-ink text-paper hover:bg-ink-soft",
        /** Reserved for the one action that finds warm paths. */
        signal: "bg-signal text-white hover:bg-[#a81b5c]",
        outline:
          "border border-hairline bg-surface text-ink hover:border-ink hover:bg-paper",
        ghost: "text-ink-soft hover:bg-black/[0.05] hover:text-ink",
        danger:
          "border border-signal/35 bg-transparent text-signal hover:bg-signal-soft",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "solid", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
