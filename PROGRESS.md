# Referral Finder — build progress

Snapshot: **2026-09-15**. Plan of record:
`C:\Users\ram\.claude\plans\tingly-noodling-rabbit.md` (10-step build order).

---

## Where the build is

| Step | Scope | State |
|---|---|---|
| 1 | Scaffold, Tailwind v4, Prisma schema, `db.ts` | **done** |
| 2 | LinkedIn OAuth, `proxy.ts`, landing page | **done**, not yet run against real credentials |
| 3 | CSV parse + upload UI | **done**, 25 tests |
| 4 | `normalize.ts` + `aliases.ts` | **done**, 25 tests |
| 5 | ATS adapters + `fetch-with-retry.ts` | **done**, 5 adapters + registry, 16 live tests |
| 6 | `ats-registry.json` seed + `resolve.ts` | **done**, 13 unit + 6 live tests |
| 7 | `run-search.ts` + `rank.ts` | **done**, 44 tests, wired to the dashboard |
| 8 | Results UI, message drafter, tracker | partial (`/connections` + read-only match list built) |
| 9 | Privacy page, delete-all, settings | not started |
| 10 | README, deploy notes | not started |

Tests: **123 unit passing** (`npm test`) + **22 live passing** (`npm run test:ats`),
`tsc --noEmit` clean, `npm run build` clean. Verified 2026-09-28.

---

## Step 5 — done

All five provider APIs were probed live and their field shapes recorded in
[NOTES-ATS.md](NOTES-ATS.md). Read that first; three of the five have a quirk
that silently corrupts results if you trust the docs instead.

Written and verified:

- `src/lib/ats/types.ts` — `NormalizedJob`, `AtsAdapter`, `AtsError` (with
  `isConclusive`, the 404-vs-timeout distinction the cache depends on), and the
  shared helpers `textOrNull` / `dateOrNull` / `joinLocation` / `looksRemote` /
  `collectJobs` (which now also collapses duplicate `externalId`s).
- `src/lib/ats/fetch-with-retry.ts` — timeout per attempt, retry on 429/5xx/network
  only, `Retry-After` honoured, full jitter, 32 MB response cap, descriptive
  User-Agent (`ATS_USER_AGENT` env override).
- `src/lib/ats/greenhouse.ts`, `lever.ts`, `ashby.ts`, `workable.ts`,
  `smartrecruiters.ts` (the paginating one, `emptyBoardProvesToken: false`).
- `src/lib/ats/index.ts` — `provider → adapter` registry, `fetchJobs()`, and
  `parseBoardUrl()` sweeping all five for the manual-override path.
- `src/lib/ats/index.test.ts` — pure: registry completeness, the
  `emptyBoardProvesToken` flags, `parseBoardUrl` round-trips.
- `src/lib/ats/adapters.live.test.ts` — network: each verified token returns a
  non-empty well-formed `NormalizedJob[]`; bogus tokens throw `not_found` on the
  four that 404 and return `[]` on SmartRecruiters. `npm run test:ats`.

Live-test find worth keeping: Workable's `zego` board lists one posting twice
(38 entries, 37 shortcodes). Fixed generically in `collectJobs` — see the
decisions section.

Step 6 (`resolve.ts`) is the first consumer of `src/lib/ats/`.

## Step 6 — done

Company resolution turns a normalised name into a `Company` row bound to an ATS
board (or a cached negative), in three layers that all write to the shared,
global `Company` table so one user's resolution is cached for everyone:

- `src/lib/company/similarity.ts` — pure Jaro-Winkler. `bestFuzzyMatch` adopts a
  near-identical existing name only above **0.97**, refuses an ambiguous top-two
  (within 0.01), and skips candidates differing in length by > 3. A wrong merge
  is the product's worst failure, so the bar is punishing on purpose.
- `src/lib/company/resolve.ts` — the engine. Exact match / fresh cache settled
  from one `findMany`; genuine unknowns are fuzzy-adopted (new names only), else
  probed across the provable providers × slug candidates, concurrency-capped at 5.
  A conclusive `not_found` moves to the next candidate; any inconclusive error
  (timeout/429/5xx/network) leaves the row unresolved so a negative is **never**
  cached from ignorance. `applyBoardUrl` is the manual paste-a-URL override
  (`resolveStatus: "manual"`, never expires). Negative cache TTL is 30 days.
- `src/lib/company/registry.ts` — node-safe loader (extensionful imports, no `@/`)
  shared by the seed. `prisma/data/ats-registry.json` holds only **verified**
  entries; `prisma/seed.ts` is offline, idempotent, and builds its own
  `PrismaClient`. `registry.live.test.ts` (`npm run test:ats`) fails if any seed
  token stops pointing at a live board.

### Toolchain constraint: `node prisma/seed.ts`

`prisma db seed` runs `node prisma/seed.ts` (per `prisma.config.ts`). Node's
native TS stripping needs **explicit `.ts` extensions** on relative imports and
**cannot resolve the `@/` alias**. So the seed constructs its own `PrismaClient`
rather than importing `src/lib/db.ts` (which uses `@/`), and everything in the
seed's import graph (`registry.ts`, `normalize.ts`, the generated client) uses
extensionful relative paths. Registry token verification lives in a live test,
not the seed, keeping the seed offline and CI-safe.

### Registry is 5 verified entries, not ~400

The plan called for ~400 curated companies. Fabricating that many unverified
name→token mappings would ship exactly the false matches the whole design guards
against (and red `registry.live.test.ts` rows). Instead the registry is a small,
audited fast-path cache that grows by curation; the probe and manual-URL layers
of `resolve.ts` cover the long tail. See the file's `$note`.

## Step 7 — done

Search, end to end: connections -> companies -> boards -> ranked matches, behind
one button.

- `src/lib/search/rank.ts` — pure filter + score policy, no DB and no network.
  `score = 55·connectionStrength + 18·titleRelevance + 12·seniorityFit +
  8·locationFit + 7·recency`, every component normalised 0–1 first.
  `connectionStrength` outweighs everything else combined on purpose: a job board
  can already tell you a role is open, and the only thing this app knows that
  they don't is that you have a named contact there. It blends a log-scaled
  count (saturating at 8 contacts) with the best single contact's `referrerPower`
  (recruiter 1.0 > leader 0.8 > manager 0.6 > anyone 0.25, +0.25 for working in
  the role's discipline).
- `src/lib/search/run-search.ts` — the orchestrator. Opens a `SearchRun`, groups
  the user's connections by `companyNorm`, then works in chunks of 20: resolve
  the chunk, fetch each company's board past a **6h TTL**, sync postings, filter,
  score, write `Match` rows, flush the counters. Capped at `FETCH_CONCURRENCY=5`
  and abandoned after a 10-minute deadline.
- `src/lib/search/matches.ts` — the read path, kept separate so a page that only
  renders results doesn't import the ATS stack.
- `src/app/dashboard/actions.ts` — `startSearch()` returns a run id immediately
  and does the work in `after()`; `getSearchProgress(runId)` is the poll.
- `src/app/dashboard/_components/search-runner.tsx` — the button, a 1.5s poll,
  a progress bar, and `router.refresh()` when the run closes.

### Why polling, not SSE

An SSE connection dies quietly behind serverless proxies and function timeouts,
leaving the user watching a bar that has silently stopped. A failed poll just
retries on the next tick (8 consecutive failures gives up and says so).

### Postings are diffed, never blind-upserted

One Greenhouse board can carry 583 postings. Upserting each per refresh would be
~583 statements per company; instead `syncPostings` reads what we hold, then
`createMany`s the new, `update`s only content-changed rows, and batches a single
`updateMany` to touch `fetchedAt` on the unchanged. Postings that vanished are
flipped `isOpen: false`, **never deleted** — a `Match` or `ReferralAsk` must keep
its referent. `[source, externalId]` is globally unique, so `createMany` has a
P2002 fallback to per-row upsert.

### Two invariants the run must not break

- **`Match.state` is never overwritten.** A dismissed match must stay dismissed
  when the next run finds the same role still open; only `score` and
  `connectionCount` are refreshed.
- **`Company.lastFetchedAt` is set only after a successful fetch**, so a failed
  board retries next run instead of being trusted for 6 hours.

### One bad company must not cost the user the other 200

Every per-company failure is caught, recorded on the run as
`{company, reason}` (capped at 50, JSON in `errorsJson`), and stepped over — then
shown in the UI, because a company whose board couldn't be read has no results
and the user should not read that as "nobody there is hiring". Progress writes
swallow their own errors so a failed counter update can't kill a live run.

## Known gaps and dead links

- **`/privacy` does not exist** but is linked from `src/app/page.tsx:202` and
  `src/app/onboarding/page.tsx:189` — two live 404s. This is the one gap that is
  not merely cosmetic: the app processes PII about people who are not users and
  have not consented, so the privacy page is a legal obligation under GDPR and
  India's DPDP Act, not step-9 polish. Worth pulling forward.
- `/tracker` and `/settings` are unbuilt but also unlinked, so no dead links.
- Dashboard's **Find referrals button is deliberately disabled**, with copy
  saying search is still being built, rather than a button that does nothing.
- LinkedIn OAuth has never run against real credentials. With
  `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` unset the landing page renders
  `SetupNotice`, and `/onboarding`, `/dashboard` and `/connections` all redirect
  to `/` via `proxy.ts` — so none of the signed-in UI has been seen rendered with
  real data. Verifying it needs a LinkedIn dev app with
  `http://localhost:3000/api/auth/callback/linkedin` as a redirect URL.
- `.env.example`'s header says "Copy to `.env.local`", but Prisma reads `.env`.
  Misleading; one-line fix.
- `npm audit` reports **3 high-severity findings** in the `prisma` CLI's
  transitive `@prisma/config`. Dev-only dependency, not shipped.
  `npm audit fix --force` downgrades and breaks the toolchain, so it is being
  left alone deliberately.

---

## Decisions worth not re-litigating

- **Email addresses from the CSV are parsed and then dropped**, never persisted.
  Not holding the data is the only way to be sure it cannot leak.
- **Re-uploads are additive and idempotent.** Existing rows are refreshed
  (titles change), absent rows are left alone — a contact changing jobs must not
  delete them from the network.
- **Parsing stays separate from normalisation.** The parser is faithful to the
  file; normalisation is lossy. A bad normalisation rule can therefore never
  corrupt what we believe the file said.
- **The normaliser is tuned against false merges, not for recall.**
  `LEGAL_SUFFIXES` deliberately excludes `spa`, `as`, `technologies`, `labs`,
  `solutions`, `systems`. Telling someone they know a person at a company where
  they don't is the failure that destroys trust in the whole product.
  `normalize.test.ts` has a standing "companies that are genuinely different"
  table — add to it rather than loosening a rule.
- **Greenhouse `department` is intentionally `null`.** Reasoning and the
  measurements behind it are in NOTES-ATS.md.
- **`collectJobs` collapses duplicate `externalId`s** for every adapter. A board
  can list one posting twice (Workable's `zego` does), and `JobPosting` is unique
  on `[source, externalId]`, so a later upsert of the twin would clobber the
  first. Dedup at the adapter boundary keeps output honest to that constraint.

### Hazard: never write `\uXXXX` escape text through Write/Edit

The tool layer converts the six characters `\u0000` into an actual NUL byte, so
escape sequences written into source become literal control characters. This bit
this build three times. Use Unicode **property** escapes (`\p{Script=Inherited}`)
or build the value from an expression instead — for example the CSV dedup key
uses `JSON.stringify([first, last, company])` specifically to avoid needing a
separator escape at all.
