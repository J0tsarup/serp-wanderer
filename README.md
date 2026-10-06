# SERP Wanderer

A small, self-hosted Google rank tracker. Add domains and keywords, and it
records where each keyword ranks — on a schedule or on demand — using
**Bright Data's SERP API** or **Scraping Robot**. Optional Google Search
Console integration adds real clicks and impressions.

Built with Next.js 14 (App Router), Prisma, Postgres (Neon works well) and
Tailwind. Designed for Vercel, runs anywhere Node runs.

---

## Features

- **Rank tracking** per keyword, by country, US city and device, with
  history, sparklines and up/down deltas.
- **Two providers, one pipeline** — pick Bright Data or Scraping Robot in
  Settings; ranking and link handling are shared code.
- **Keyword panel** — click a keyword for 7 / 30 / 90-day position history
  and the Google results captured in its latest check, your site
  highlighted.
- **Batched refreshes** — scheduled runs and "Refresh now" work in short
  batches, so large keyword lists never hit function time limits. Tick
  keywords and the button becomes **Refresh selected**.
- **Stops early** after 3 failures in a row that look like an outage or a
  block, and says why.
- **Failed checks are kept separate** from "not ranking", and can be cleared
  per row or in bulk.
- **Tags, bulk actions, CSV export** (latest or full history).
- **Search Console** (optional) — clicks and impressions next to each
  keyword, a property per domain, untracked queries you already rank for,
  an insights page, and a weekly email digest.
- **Multi-user, invite-only** — each account has its own domains and
  credentials.

## How ranking works

1. Each check fetches one page (≈10 organic results) from the selected
   provider, and keeps paging (`start=10, 20, …`) up to the **check depth**
   in Settings (10 / 30 / 50 / 100), stopping as soon as your domain appears.
2. Every result is normalised to the same shape (`lib/serp/resolve.ts`), and
   your domain is matched the same way for every provider:
   - a real link is used directly;
   - an old-style Google redirect (`/url?q=…`) is decoded;
   - Google's signed-out redirect (`/goto?url=<token>`) contains no address,
     so the site is identified from the address Google prints under the
     result — and only the matching result has its real URL looked up.
3. Positions count organic results only (Bright Data's `rank`, not
   `global_rank`), and later pages are numbered from the results actually
   returned rather than an assumed 10 per page.
4. Each check is stored in `RankCheck`; failures carry an `error`.

Provider notes:

| | Bright Data | Scraping Robot |
|---|---|---|
| Output | Parsed JSON (falls back to reading HTML if JSON doesn't come through) | Raw Google HTML, parsed by the app |
| Mobile | ✓ | ✗ (desktop only) |
| City targeting | Plain canonical name | Encoded `uule` (handled by the app) |
| Retries | 1 retry on timeout / 5xx (60s timeout) | Up to 3 tries on a fresh proxy |

## Getting started

```bash
npm install
cp .env.example .env      # fill in the values below
npm run db:push           # create tables
npm run dev               # http://localhost:3000
```

Sign up at `/signup`, then add your provider credentials in **Settings →
Rank checks**, add a domain and a keyword.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✓ | Postgres connection string |
| `CRON_SECRET` | ✓ | Protects the cron endpoints (`openssl rand -base64 32`) |
| `SIGNUP_INVITE_CODE` | recommended | Code required at `/signup`. If unset, only the first account can sign up |
| `BRIGHTDATA_API_KEY`, `BRIGHTDATA_SERP_ZONE`, `SCRAPINGROBOT_TOKEN` | – | Optional fallbacks; credentials saved in Settings take priority |

Provider keys, Search Console credentials and the Resend key are entered in
the app, per account — not in env vars.

## Deploying

### Vercel

1. Import the repo, add the env vars above.
2. `vercel.json` schedules `/api/cron/refresh` four times a day and the
   weekly digest on Mondays. Vercel sends `CRON_SECRET` automatically.
   Each run only checks keywords not checked in the last 20 hours, so extra
   runs cost nothing.

Functions can run up to 300s on every plan with Fluid compute (the default);
each refresh batch stops with time to spare.

### Render (or any Node host)

Build `npm run build`, start `npm run start`. Point a cron at
`https://your-app/api/cron/refresh?secret=$CRON_SECRET` as often as you like.

## Database updates

New columns are listed in `lib/schema-check.ts`. When upgrading, run
`npm run db:push` — or paste the SQL into your database console —
**before** deploying. If the code goes live first, the app shows a
"Database needs an update" page with the exact SQL instead of crashing.
All statements are safe to re-run:

```sql
ALTER TABLE "RankCheck" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "serpProvider" TEXT NOT NULL DEFAULT 'brightdata';
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "scrapingRobotToken" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "scrapingRobotRender" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Domain" ADD COLUMN IF NOT EXISTS "gscSiteUrl" TEXT;
ALTER TABLE "Keyword" ADD COLUMN IF NOT EXISTS "serpSnapshot" JSONB;
```

## Search Console (optional)

Each account connects with its own Google Cloud OAuth client:

1. In [Google Cloud Console](https://console.cloud.google.com), enable the
   **Search Console API**.
2. Configure the **OAuth consent screen** (External is fine), add the
   `webmasters.readonly` scope, and add yourself as a test user.
3. Create an **OAuth Client ID** (Web application) with redirect URI
   `https://your-domain/api/google/callback`
   (plus `http://localhost:3000/api/google/callback` for local testing).
4. Paste the Client ID and Secret into **Settings → Search Console**, click
   **Connect**, and pick a property.

Each domain page shows which property feeds it, with a "change" link.
Without one, the account's property is used only if it covers that domain
(`sc-domain:example.com` covers subdomains; URL-prefix properties match on
hostname).

While the consent screen is in Testing mode, Google shows an "unverified
app" warning — choose **Advanced → Go to (app)**. Google's API doesn't
provide per-query data for Discover or News; the insights page switches to
another grouping automatically.

**Weekly digest:** add a [Resend](https://resend.com) API key and recipient
in **Settings → Email digest**. Sends Mondays 13:00 UTC from Resend's
sandbox address.

## Project structure

```
app/                 pages and API routes (App Router)
  api/cron/          scheduled refresh + weekly digest
  api/keywords/      add, bulk add, bulk actions, keyword detail
  api/domains/       domains, batched refresh, tags, GSC discovery
components/          UI (KeywordTable, KeywordDrawer, Settings forms, …)
lib/
  rank.ts            checks a keyword; batched refresh with stop-early
  brightdata.ts      Bright Data client
  scrapingrobot.ts   Scraping Robot client
  serp/              shared: result matching, link resolving, HTML parser,
                     uule encoding, provider switch, snapshot types
  google.ts          Search Console OAuth + API
  schema-check.ts    detects missing DB columns
prisma/schema.prisma
```

## Scripts

| Command | |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (`next/core-web-vitals`) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:push` | Apply `schema.prisma` to the database |
| `npm run db:studio` | Browse the database |

CI (`.github/workflows/ci.yml`) runs lint, typecheck and build on every
push and pull request.

## Not built yet

- **Search volume / keyword ideas** — needs a Google Ads developer token
  (manual approval by Google).
- **Position-change alerts** — `lib/rank.ts` is the place to add them.
