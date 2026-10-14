# ATS board APIs — verified field shapes and probe behaviour

Everything in this file was **read off a live response**, not from documentation.
Probed 2026-08-25 with the scripts described at the bottom. Where a claim is
inferred rather than observed it says so.

Why it exists: five providers, five JSON dialects, and three of the five have a
quirk that would silently corrupt results if you trusted the docs. The
[`src/lib/ats`](src/lib/ats) adapters encode all of this; this file is the
evidence behind them.

---

## Summary table

| Provider | Endpoint | Title field | Stable id | Remote flag | Dept | Pages? | Bogus token |
|---|---|---|---|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | `title` | `id` (number) | — none — | only with `content=true` | no | **404** JSON |
| Lever | `api.lever.co/v0/postings/{token}?mode=json` | **`text`** | `id` (uuid) | `workplaceType` | `categories.department` | no | **404** JSON |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{token}` | `title` | `id` (uuid) | `isRemote` | `department` | no | **404** *text* |
| Workable | `apply.workable.com/api/v1/widget/accounts/{token}?details=true` | `title` | **`shortcode`** | `telecommuting` | `department` | no | **404** *text* |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{token}/postings` | **`name`** | `id` (numeric string) | `location.remote` | `department.label` | **yes, 100/page** | **200 + empty** ⚠ |

Verified live tokens (these actually returned postings on 2026-08-25 — keep them,
finding a Workable one took 40 candidates):

| Provider | Token | Postings |
|---|---|---|
| Greenhouse | `stripe` | 583 |
| Lever | `spotify` | 95 |
| Lever | `leverdemo` | 384 |
| Ashby | `ashby` | 59 |
| Workable | `zego` | 39 |
| SmartRecruiters | `Fiverr` | 3 |

---

## The three quirks that matter

### 1. SmartRecruiters cannot be slug-probed at all ⚠

A nonsense token returns **HTTP 200** with a body byte-identical to a real
company that has nothing open:

```
GET /v1/companies/zzqx-not-a-real-company-9184/postings?limit=5   → 200
{"offset":0,"limit":5,"totalFound":0,"content":[]}

GET /v1/companies/Bosch/postings?limit=5                          → 200
{"offset":0,"limit":5,"totalFound":0,"content":[]}
```

`Bosch`, `Ubisoft`, `McDonalds`, `Square`, `Avature`, `PublicisGroupe`,
`Twitter`, `Skechers`, `IKEA` and `Visa` all returned exactly that too. There is
no way to tell from this endpoint whether any of them is a real board.

**Consequence for `resolve.ts`:** on SmartRecruiters, only `totalFound > 0` is
evidence. A zero result proves nothing and must **never** be written as a
`no_board` negative — do that and the company is poisoned in the global cache
for 30 days for every user. This is why `AtsAdapter` carries
`emptyBoardProvesToken`, which is `true` for the other four and `false` here.

Corollary: SmartRecruiters companies effectively have to come from the seeded
registry or a pasted board URL, not from slug probing.

### 2. Greenhouse hides `departments` behind a 12× payload

Same board (`stripe`, 583 jobs), three endpoints:

| Request | Bytes | Has `departments`? |
|---|---|---|
| `/jobs` | 364,632 | no |
| `/jobs?content=true` | 4,456,202 | yes |
| `/departments` | 475,119 | yes (jobs nested under each) |

`?content=true` inlines every full HTML job description to deliver one extra
field. `/departments` is a cheaper way to get it (1012 departments, 202 with
jobs, 583 jobs total — an exact match with `/jobs`, so nothing was lost for
Stripe), but a job with no department assigned would not appear under any
department at all, and losing a whole posting is far worse than losing a soft
ranking signal.

Decided: fetch plain `/jobs`, leave `department: null` on Greenhouse. Clinching
argument is that the field is nearly worthless anyway — Greenhouse departments
are internal cost centres, and Stripe's read:

```
1130 Global Sales Development Mgrs
1653 Startups - Account Executives (NA)
```

Nothing in a connection's LinkedIn job title will ever match that. Expensive
*and* weak, so it's dropped. Revisit only if a real board shows clean
department names and the ranker actually needs them.

### 3. Two providers answer 404 with plain text, not JSON

Ashby and Workable both return the nine bytes `Not Found` with
`content-type: text/plain`. Greenhouse and Lever return JSON error objects. Any
error handler that tries to parse the body before checking the status will throw
the wrong error type here — which is why `fetch-with-retry.ts` classifies on
status alone and never reads an error body.

---

## Per-provider detail

### Greenhouse

`GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs`

```
{ jobs: [...], meta: { total: number } }
```

Job fields without `content=true`:

```
absolute_url, data_compliance, education, internal_job_id, location,
metadata, id, updated_at, requisition_id, title, company_name,
first_published, language, application_deadline
```

`content=true` additionally supplies `content`, `departments[]`, `offices[]`,
`ai_disclaimer`, `include_ai_disclaimer`, `ai_opt_out_request_url`.

Observed values:

```json
{
  "id": 8130725,
  "title": "Account Executive, AI Startups (Hunter)",
  "location": { "name": "San Francisco" },
  "updated_at": "2026-08-19T14:02:07-04:00",
  "first_published": "2026-08-19T14:02:07-04:00",
  "absolute_url": "https://stripe.com/jobs/search?gh_jid=8130725"
}
```

- `id` is a **number**, and there are two of them: `id` and `internal_job_id`.
  `id` is the one that appears in `absolute_url` as `gh_jid`.
- `location.name` is not trimmed — observed `"Dublin "` with a trailing space.
- `content` is **HTML-entity-escaped**, so it arrives as `&lt;h2&gt;` rather than
  `<h2>`. Double-decoding needed if it is ever displayed.
- No remote flag anywhere. Remote has to be inferred from `location.name`.
- Whole board in one response; no pagination parameters.
- Bogus board → `404 {"status":404,"error":"Job not found"}`.
  Bogus `/departments` → `404 {"status":404,"error":"Department not found"}`.

### Lever

`GET https://api.lever.co/v0/postings/{token}?mode=json`

Top level is a **bare array**, not an object.

```
additionalPlain, additional, categories{commitment, department, location,
team, allLocations[]}, createdAt, descriptionPlain, description, id, lists[],
text, country, workplaceType, opening, openingPlain, descriptionBody,
descriptionBodyPlain, hostedUrl, applyUrl
```

- **Title is `text`.** There is no `title` field.
- `createdAt` is **epoch milliseconds** (`1784569799619`), not a string.
- `workplaceType` ∈ `onsite` | `hybrid` | `remote` (observed `"hybrid"`).
- `country` is ISO-3166-2 (`"GB"`); the readable location is
  `categories.allLocations[]` / `categories.location`.
- `hostedUrl` is the human page; `applyUrl` is the same plus `/apply`.
- Real accounts with nothing open return `200 []` — verified on `lever`,
  `plaid`, `mistral`.
- 404 on `brex`, `shopify`, `ycombinator`, `figma`, `opendoor`, `netflix` —
  so the plan's suggested Lever smoke-test token (`netflix`) is dead; use
  `spotify`.

### Ashby

`GET https://api.ashbyhq.com/posting-api/job-board/{token}`

```
{ jobs: [...], apiVersion: "1" }
```

```
id, title, department, team, employmentType, location, secondaryLocations[],
publishedAt, isListed, isRemote, workplaceType, address{postalAddress{...}},
jobUrl, applyUrl, descriptionHtml, descriptionPlain
```

- Cleanest of the five: honest field names, explicit `isRemote`, ISO
  `publishedAt` (`"2024-03-04T14:29:08.532+00:00"`).
- **`isListed` is the trap.** A board can carry postings it does not publish;
  surfacing one sends the user to a dead link. Adapter drops `isListed === false`
  only — an *absent* flag is trusted, since dropping those would lose postings
  on older board shapes.
- `secondaryLocations[]` can be long (19 entries on one Ashby role).
- `employmentType` is CamelCase (`"FullTime"`), `workplaceType` is
  Capitalised (`"Remote"`) — different casing convention from Lever's lowercase.

### Workable

`GET https://apply.workable.com/api/v1/widget/accounts/{token}?details=true`

```
{ name, description, jobs: [...] }
```

```
title, shortcode, code, employment_type, telecommuting, department, url,
shortlink, application_url, published_on, created_at, country, city, state,
education, experience, function, industry, locations[], description
```

- **No `id` field.** `shortcode` (`"B76C11B977"`) is the stable key.
- **A board can list the same posting twice** — `zego` returned 38 entries for 37
  distinct shortcodes (a job cross-posted across departments). Since shortcode is
  the primary key (it *is* the `/j/{shortcode}` apply URL), the twin is the same
  job. `collectJobs` collapses duplicate `externalId`s for every provider so the
  DB's `[source, externalId]` uniqueness is never violated by an upsert.
- Remote flag is named **`telecommuting`** (boolean).
- `published_on` / `created_at` are bare `YYYY-MM-DD`, which `Date` reads as
  UTC midnight.
- Location comes as separate `city` / `state` / `country` plus a `locations[]`
  array with `countryCode` and a `hidden` flag.
- `description` on the *account* may be `null`; on a job it is HTML.
- There is a second endpoint, `POST /api/v3/accounts/{token}/jobs` with body
  `{}`, returning `{total, results[]}`. It agreed with v1 on counts for every
  token tested, so v1 is kept (a GET is cacheable and simpler).
- **Most Workable accounts have zero public postings.** 200-with-`jobs: []`
  verified on `ecovadis`, `payhawk`, `glovo`, `typeform`, `personio`, `preply`,
  `onfido`, `crossover`, `tide`, `hubspot`, `omnipresent`, `workable-demo`;
  404 on `bunq`, `swordhealth`, `veeva`, `kaizengaming`, `pipedrive`,
  `hostaway`. Only `zego` (39) had live roles out of ~40 candidates tried.
  Budget accordingly when writing live tests.
- `apply.workable.com/j/{shortcode}` is a *posting* URL. A board-URL parser that
  takes the first path segment will read `j` as an account slug, so it is on a
  reserved-segment list in the adapter.

### SmartRecruiters

`GET https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset=N`

```
{ offset, limit, totalFound, content: [...] }
```

```
id, name, uuid, jobAdId, defaultJobAd, refNumber, company{identifier, name},
releasedDate, location{city, region, country, remote, hybrid, latitude,
longitude, fullLocation}, industry{id,label}, department{}, function{id,label},
typeOfEmployment{id,label}, experienceLevel{id,label}, customField[],
visibility, ref, language{code,label,labelNative}
```

- **Title is `name`.**
- `id` is a numeric **string** (`"743999656769142"`), and there is also a `uuid`
  and a `refNumber` — three identifiers, none interchangeable.
- **`department` can be `{}`** — an empty object, not null and not absent. So
  `department.label` is `undefined` and any non-optional access throws.
- `location.country` is **lowercase** ISO-2 (`"us"`). `location.remote` and
  `location.hybrid` are separate booleans. `fullLocation` is the readable one.
- **`ref` is an API URL**, not a careers page:
  `https://api.smartrecruiters.com/v1/companies/Fiverr/postings/7439996…`.
  Using it as the user-facing link would send someone to raw JSON. The human
  page is `https://jobs.smartrecruiters.com/{company.identifier}/{id}`, verified
  200 (content-negotiated — JSON with `Accept: application/json`, the posting
  page in a browser). `careers.smartrecruiters.com/...` 302-redirects, so
  `jobs.` is canonical.
- **`limit` silently caps at 100.** Asked for 200, got `"limit":100` back with no
  error. Pagination via `offset` against `totalFound` is mandatory; this is the
  only one of the five that paginates.
- Tokens are **case-sensitive CamelCase** (`Fiverr`, `PublicisGroupe`).
  Lower-casing them 404s — or rather, given quirk 1, returns an
  indistinguishable empty result, which is worse.
- `visibility: "PUBLIC"` observed; filter defensively in case internal postings
  ever leak into this endpoint.

---

## Network behaviour

20 concurrent `fetch` calls to `apply.workable.com` produced:

```
TypeError: fetch failed
  [cause]: Error: getaddrinfo ENOTFOUND apply.workable.com
    errno: -3008, code: 'ENOTFOUND'
```

The host was fine seconds later — this is the local DNS resolver giving up under
burst, not the provider. Two conclusions, both already in
`fetch-with-retry.ts`: network-level errors must be retried and must **never** be
recorded as `not_found`, and search concurrency stays capped (`p-limit` 5 per the
plan) rather than fanning out over a whole network at once.

---

## Reproducing this

The probes were throwaway scripts under `/tmp`, not committed. To re-verify a
provider, the minimum is:

```bash
curl -s -H 'User-Agent: ReferralFinder/0.1' 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs' | head -c 400
```

The durable version of these checks is the live suite, which is **not yet
written** (see `PROGRESS.md`):

```bash
npm run test:ats
```
