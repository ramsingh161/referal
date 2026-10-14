import Link from "next/link";
import { redirect } from "next/navigation";

import { CsvDropzone } from "./_components/CsvDropzone";
import { PrefsForm } from "./_components/PrefsForm";
import { auth } from "@/auth";
import { Panel, PanelTitle } from "@/components/ui/panel";
import { Wordmark } from "@/components/wordmark";
import { prisma } from "@/lib/db";
import { parsePreferences } from "@/lib/prefs";

export const metadata = { title: "Set up — Referral Finder" };

/**
 * Onboarding.
 *
 * Both steps stay on one page rather than behind a wizard: step one requires
 * leaving the app and waiting ~10 minutes for LinkedIn's email, and a user who
 * comes back should land on something that shows them exactly where they got to.
 */
export default async function OnboardingPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const [user, connectionCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { prefsJson: true, onboardedAt: true },
    }),
    prisma.connection.count({ where: { userId } }),
  ]);

  const hasConnections = connectionCount > 0;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
          <Wordmark />
          {user?.onboardedAt && (
            <Link
              href="/dashboard"
              className="label text-muted transition-colors hover:text-ink"
            >
              Back to dashboard
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-14">
        <p className="label text-signal">Setup</p>
        <h1 className="mt-4 font-heading text-3xl leading-tight font-extrabold tracking-[-0.02em] text-ink">
          Two things, then you're done
        </h1>

        {/* The steps sit on a single vertical line: this is a genuine sequence,
            and the second step cannot be completed before the first. */}
        <ol className="mt-12">
          <Step
            index={1}
            title="Add your connections"
            done={hasConnections}
            isLast={false}
          >
            <GetTheFile />
            <div className="mt-7">
              <CsvDropzone hasExistingConnections={hasConnections} />
            </div>
          </Step>

          <Step
            index={2}
            title="Say what you're looking for"
            done={Boolean(user?.onboardedAt)}
            isLast
          >
            <p className="text-ink-soft">
              All optional. Skip it and you'll see every open role at every company
              where you know someone — which is a fine way to start.
            </p>
            <div className="mt-7">
              <PrefsForm
                initial={parsePreferences(user?.prefsJson)}
                canSubmit={hasConnections}
              />
            </div>
          </Step>
        </ol>
      </main>
    </div>
  );
}

/**
 * One step, drawn as a stop on a line. Completed stops fill in solid; pending
 * ones stay hollow, the same interchange convention the route diagrams use.
 */
function Step({
  index,
  title,
  done,
  isLast,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  isLast: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-5 sm:gap-7">
      <div className="flex flex-col items-center" aria-hidden>
        <span
          className={
            done
              ? "mt-1 size-4 shrink-0 rounded-full bg-signal"
              : "mt-1 size-4 shrink-0 rounded-full border-[3px] border-signal bg-surface"
          }
        />
        {!isLast && <span className="w-[3px] flex-1 bg-signal/25" />}
      </div>

      <div className={isLast ? "min-w-0 flex-1" : "min-w-0 flex-1 pb-14"}>
        <div className="flex items-baseline gap-3">
          <PanelTitle>{title}</PanelTitle>
          {done && <span className="label text-conduit">Done</span>}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </li>
  );
}

/**
 * How to get the export. Numbered because it is a strict procedure inside
 * LinkedIn's settings — the order carries information the reader needs — and
 * because getting lost here is the single most likely reason someone abandons
 * the app.
 */
const STEPS_TO_EXPORT = [
  <>
    Open{" "}
    <a
      className="text-signal underline underline-offset-2"
      href="https://www.linkedin.com/mypreferences/d/download-my-data"
      target="_blank"
      rel="noreferrer"
    >
      LinkedIn's data export page
    </a>{" "}
    (Settings → Data privacy → Get a copy of your data).
  </>,
  <>
    Choose <strong className="font-semibold text-ink">Want something in particular?</strong>{" "}
    and tick <strong className="font-semibold text-ink">Connections</strong> only.
  </>,
  <>
    Press <strong className="font-semibold text-ink">Request archive</strong> and confirm
    your password.
  </>,
  <>
    LinkedIn emails a download link, usually within ten minutes. Unzip it and you'll
    find <span className="font-mono text-[0.8rem] text-ink">Connections.csv</span>.
  </>,
];

function GetTheFile() {
  return (
    <Panel className="bg-paper/50">
      <p className="label text-muted">Where the file comes from</p>

      <ol className="mt-4 space-y-3">
        {STEPS_TO_EXPORT.map((content, index) => (
          <li key={index} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
            <span className="label mt-0.5 w-4 shrink-0 text-signal">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">{content}</span>
          </li>
        ))}
      </ol>

      <p className="mt-5 border-t border-hairline pt-4 text-sm text-muted">
        We read names, companies, job titles and connection dates. We don't store
        email addresses, and we never message anyone in the file —{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
          what we do with it
        </Link>
        .
      </p>
    </Panel>
  );
}
