import { cn } from "@/lib/utils";

/**
 * The app's mark, and a miniature of its core idea: origin, interchange,
 * terminus. Reuses the route grammar rather than introducing a second visual
 * system for branding.
 */
export function RouteMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex items-center gap-[3px]", className)}
    >
      <span className="size-[7px] rounded-full bg-signal" />
      <span className="h-[2px] w-2 bg-signal" />
      <span className="size-[9px] rounded-full border-[2.5px] border-signal bg-surface" />
      <span className="h-[2px] w-2 bg-conduit" />
      <span className="size-[6px] rotate-45 bg-conduit" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <RouteMark />
      <span className="font-heading text-[0.95rem] font-bold tracking-tight text-ink">
        Referral Finder
      </span>
    </span>
  );
}
