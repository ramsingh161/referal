import { cn } from "@/lib/utils";

/**
 * A stop on a referral route.
 *
 *   you     — the user. Always the origin.
 *   contact — a person the user already knows at the company. This is the
 *             interchange: the whole point of the diagram is to name who to ask.
 *   role    — the open position. Always the terminus.
 */
export type RouteStop = {
  kind: "you" | "contact" | "role";
  label: string;
  sublabel?: string;
};

type RouteDiagramProps = {
  stops: RouteStop[];
  /** Play the draw-in animation. Off by default so lists don't flicker. */
  animate?: boolean;
  size?: "sm" | "lg";
  className?: string;
};

/**
 * The app's signature element: a transit-style route from the user to an open
 * role, through the person who can refer them.
 *
 * Built from HTML rather than SVG so the labels wrap, scale with the user's font
 * size, and stay selectable. On narrow screens the row collapses to a vertical
 * list — the same information, read top to bottom.
 *
 * Interchange convention borrowed from transit maps: a ringed hollow node marks
 * a stop where you change lines, which is exactly what the contact is.
 */
export function RouteDiagram({
  stops,
  animate = false,
  size = "sm",
  className,
}: RouteDiagramProps) {
  const isLarge = size === "lg";

  return (
    <ol
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0",
        animate && "route-animate",
        className,
      )}
    >
      {stops.map((stop, index) => {
        const isLast = index === stops.length - 1;
        // Stops land after the connector that reaches them has drawn.
        const stopDelay = index * 0.34;
        const connectorDelay = stopDelay + 0.16;

        return (
          <li
            key={`${stop.kind}-${stop.label}`}
            className="flex items-start gap-3 sm:min-w-0 sm:flex-1 sm:items-start sm:gap-0 sm:last:flex-none"
          >
            {/* --- the stop itself --- */}
            <div className="flex shrink-0 flex-col items-center sm:w-full sm:shrink">
              <div className="flex w-full items-center">
                <StopMarker
                  kind={stop.kind}
                  size={size}
                  style={{ animationDelay: `${stopDelay}s` }}
                />

                {/* Connector to the next stop. Horizontal on wide screens. */}
                {!isLast && (
                  <span
                    aria-hidden
                    className={cn(
                      "route-connector hidden h-[3px] flex-1 sm:block",
                      stop.kind === "you"
                        ? "bg-signal"
                        : "bg-gradient-to-r from-signal to-conduit",
                    )}
                    style={{ animationDelay: `${connectorDelay}s` }}
                  />
                )}
              </div>

              {/* Labels sit under the node, as on a line diagram. */}
              <div
                className={cn(
                  "hidden sm:block sm:w-full sm:pr-4",
                  isLarge ? "sm:pt-3" : "sm:pt-2",
                )}
              >
                <StopLabel stop={stop} size={size} />
              </div>
            </div>

            {/* --- mobile: vertical connector + inline labels --- */}
            <div className="min-w-0 flex-1 sm:hidden">
              <StopLabel stop={stop} size={size} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StopMarker({
  kind,
  size,
  style,
}: {
  kind: RouteStop["kind"];
  size: "sm" | "lg";
  style?: React.CSSProperties;
}) {
  const isLarge = size === "lg";
  const box = isLarge ? "size-4" : "size-3";

  if (kind === "you") {
    // Origin: solid dot.
    return (
      <span
        aria-hidden
        style={style}
        className={cn("route-stop shrink-0 rounded-full bg-signal", box)}
      />
    );
  }

  if (kind === "contact") {
    // Interchange: hollow ring. The transit convention for "change here".
    return (
      <span
        aria-hidden
        style={style}
        className={cn(
          "route-stop shrink-0 rounded-full border-signal bg-surface",
          isLarge ? "size-5 border-[3.5px]" : "size-4 border-[3px]",
        )}
      />
    );
  }

  // Terminus: rotated square, so the end of the line is distinguishable from
  // its stops at a glance.
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "route-stop shrink-0 rotate-45 bg-conduit",
        isLarge ? "size-3.5" : "size-2.5",
      )}
    />
  );
}

function StopLabel({
  stop,
  size,
}: {
  stop: RouteStop;
  size: "sm" | "lg";
}) {
  const isLarge = size === "lg";

  return (
    <>
      <p
        className={cn(
          "leading-tight font-medium text-ink",
          isLarge ? "text-base sm:text-lg" : "text-sm",
          stop.kind === "you" && "text-muted",
        )}
      >
        {stop.label}
      </p>
      {stop.sublabel && (
        <p
          className={cn(
            "mt-0.5 leading-snug text-muted",
            isLarge ? "text-sm" : "text-xs",
          )}
        >
          {stop.sublabel}
        </p>
      )}
    </>
  );
}
