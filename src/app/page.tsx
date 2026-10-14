import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { RouteDiagram, type RouteStop } from "@/components/route-diagram";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

/**
 * The hero route. Deliberately concrete rather than a placeholder: the whole
 * pitch is "a named person you already know", so the diagram shows one.
 */
const HERO_ROUTE: RouteStop[] = [
  { kind: "you", label: "You" },
  {
    kind: "contact",
    label: "Priya Sharma",
    sublabel: "Staff Engineer at Stripe — connected 2019",
  },
  {
    kind: "role",
    label: "Backend Engineer, Payments",
    sublabel: "Open 6 days",
  },
];

const STEPS = [
  {
    title: "Sign in with LinkedIn",
    body: "Confirms who you are. Takes one click.",
  },
  {
    title: "Add your connections export",
    body: "Download your connections file from LinkedIn, then drop it in. We walk you through where to find it — it takes about ten minutes to arrive.",
  },
  {
    title: "Press Find referrals",
    body: "We check every company you have a contact at for open roles, then rank what comes back by who you know there.",
  },
];

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const linkedInConfigured = Boolean(
    process.env.AUTH_LINKEDIN_ID && process.env.AUTH_LINKEDIN_SECRET,
  );

  async function signInWithLinkedIn() {
    "use server";
    await signIn("linkedin", { redirectTo: "/dashboard" });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Wordmark />
          <a
            href="#how-it-works"
            className="label text-muted transition-colors hover:text-ink"
          >
            How it works
          </a>
        </div>
      </header>

      <main className="flex-1">
        {/* ---------------------------------------------------------------
            Hero. The thesis is the route itself, so the diagram is the
            largest element on the page rather than an illustration beside it.
        --------------------------------------------------------------- */}
        <section className="map-grid border-b border-hairline">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-28">
            <p className="label text-signal">Referrals you already have</p>

            <h1 className="mt-5 max-w-3xl font-heading text-4xl leading-[1.03] font-extrabold tracking-[-0.03em] text-ink sm:text-6xl">
              You already know
              <br />
              someone there.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
              Referral Finder matches your own LinkedIn connections against
              companies that are hiring right now — so instead of applying cold,
              you can see exactly who to ask.
            </p>

            {/* The signature, at full size, animating on load. */}
            <div className="mt-14 max-w-3xl border-t border-hairline pt-9">
              <p className="label mb-6 text-muted">One route, found for you</p>
              <RouteDiagram stops={HERO_ROUTE} animate size="lg" />
            </div>

            <div className="mt-14">
              {linkedInConfigured ? (
                <form action={signInWithLinkedIn}>
                  <Button type="submit" size="lg" variant="solid">
                    Continue with LinkedIn
                  </Button>
                </form>
              ) : (
                <SetupNotice />
              )}

              <p className="mt-4 max-w-md text-sm text-muted">
                Signing in shares your name, photo and email — nothing else.
                LinkedIn does not let any app read your connections, so you add
                those yourself in the next step.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            How it works. Rendered as stops on a line because it genuinely is
            a sequence — each step depends on the one before it.
        --------------------------------------------------------------- */}
        <section
          id="how-it-works"
          className="border-b border-hairline bg-surface"
        >
          <div className="mx-auto w-full max-w-6xl px-5 py-20">
            <h2 className="font-heading text-2xl font-bold tracking-tight text-ink">
              Three steps, once
            </h2>

            <ol className="mt-10 max-w-2xl">
              {STEPS.map((step, index) => {
                const isLast = index === STEPS.length - 1;
                return (
                  <li key={step.title} className="flex gap-5">
                    {/* Vertical line with a stop per step. */}
                    <div
                      className="flex flex-col items-center"
                      aria-hidden
                    >
                      <span
                        className={stopClass(isLast)}
                      />
                      {!isLast && (
                        <span className="w-[3px] flex-1 bg-signal/25" />
                      )}
                    </div>

                    <div className={isLast ? "pb-0" : "pb-10"}>
                      <h3 className="font-heading text-lg font-bold tracking-tight text-ink">
                        {step.title}
                      </h3>
                      <p className="mt-1.5 leading-relaxed text-ink-soft">
                        {step.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------------
            The honest bit. Users will wonder why an app that logs in with
            LinkedIn still asks for a file. Answering it up front is the
            difference between "broken" and "trustworthy".
        --------------------------------------------------------------- */}
        <section className="border-b border-hairline">
          <div className="mx-auto w-full max-w-6xl px-5 py-20">
            <div className="max-w-2xl">
              <p className="label text-conduit">Why the file</p>
              <h2 className="mt-4 font-heading text-2xl font-bold tracking-tight text-ink">
                LinkedIn keeps your connections to itself
              </h2>
              <div className="mt-5 space-y-4 leading-relaxed text-ink-soft">
                <p>
                  No third-party app can read your connection list — LinkedIn
                  removed that access in 2015 and never brought it back. Any tool
                  claiming otherwise is scraping, which puts{" "}
                  <em className="not-italic text-ink">your</em> account at risk
                  of being banned.
                </p>
                <p>
                  So we use the one route LinkedIn does support: your own data
                  export. You request your connections file, we read it, and it
                  stays yours. Nothing is scraped and nothing touches your
                  account.
                </p>
                <p className="text-ink">
                  We never message your connections. You send every ask
                  yourself.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <div className="flex items-center gap-5">
            <a
              href="/privacy"
              className="text-sm text-muted transition-colors hover:text-ink"
            >
              Privacy
            </a>
            <span className="text-sm text-muted">
              Not affiliated with LinkedIn
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Terminus stops render as a diamond; intermediate stops as interchange rings. */
function stopClass(isLast: boolean): string {
  return isLast
    ? "mt-1.5 size-3 rotate-45 shrink-0 bg-conduit"
    : "mt-1 size-4 shrink-0 rounded-full border-[3px] border-signal bg-surface";
}

/**
 * Shown when LinkedIn credentials are missing. An empty screen should tell you
 * what to do next, so this states the exact file and variables to fill in.
 */
function SetupNotice() {
  return (
    <div className="max-w-lg border border-caution/30 bg-caution/[0.06] p-5">
      <p className="label text-caution">Setup needed</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Add your LinkedIn app credentials to{" "}
        <code className="font-mono text-[0.8rem] text-ink">.env</code> as{" "}
        <code className="font-mono text-[0.8rem] text-ink">
          AUTH_LINKEDIN_ID
        </code>{" "}
        and{" "}
        <code className="font-mono text-[0.8rem] text-ink">
          AUTH_LINKEDIN_SECRET
        </code>
        , then reload. Create the app at{" "}
        <a
          className="text-signal underline underline-offset-2"
          href="https://www.linkedin.com/developers/apps"
          target="_blank"
          rel="noreferrer"
        >
          linkedin.com/developers
        </a>
        , request the “Sign In with LinkedIn using OpenID Connect” product, and
        add{" "}
        <code className="font-mono text-[0.8rem] text-ink">
          http://localhost:3000/api/auth/callback/linkedin
        </code>{" "}
        as a redirect URL.
      </p>
    </div>
  );
}
