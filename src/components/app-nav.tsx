import Link from "next/link";

import { signOutAction } from "@/app/actions";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

/**
 * Signed-in navigation.
 *
 * Routes are listed here as they are built rather than all at once, so the nav
 * never offers a link to a page that does not exist.
 */
const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Referrals" },
  { href: "/connections", label: "Your network" },
];

export function AppNav({ current }: { current: string }) {
  return (
    <header className="border-b border-hairline bg-surface">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-5">
        <Link href="/dashboard" aria-label="Referral Finder home">
          <Wordmark />
        </Link>

        <nav className="flex items-center gap-6">
          {NAV_LINKS.map((link) => {
            const isCurrent = current === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "label border-b-2 py-1 transition-colors",
                  isCurrent
                    ? "border-signal text-ink"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <form action={signOutAction} className="ml-auto">
          <button
            type="submit"
            className="label text-muted transition-colors hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
