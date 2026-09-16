# SERP Wanderer

A small, self-hosted keyword rank tracker: add domains, add keywords per domain,
and it checks Google positions via **Bright Data's SERP API** on a daily
schedule (or on demand). Positions are stored over time so you get a trend
line per keyword — a lightweight SerpBear-style dashboard, purpose-built
around Bright Data instead of SerpBear's other scraper integrations.

## Layout

A persistent sidebar (desktop) or domain-switcher dropdown (mobile) replaces
navigating back to a domain list page — pick a domain once and it stays
selected while you work. Adding a keyword is a button that opens a small
dialog instead of a permanent form bar. The keyword table becomes stacked
cards below the `md` breakpoint instead of a horizontally-scrolling grid.
Settings is tabbed (Bright Data / Search Console / Email digest) instead of
one long scrolling page.

## Accounts

The app is multi-user: each account has its own domains, keywords, and
Bright Data credentials — nobody sees anyone else's data. Sign up with a
username and password at `/signup` (no email verification — this is meant
for a small team or personal use, not public signups). Log in at `/login`.

**Upgrading an existing deployment:** if you were already running this
before accounts existed, the very first account you sign up automatically
takes ownership of whatever domains/keywords/settings already existed — no
manual data migration needed beyond running the SQL migration below.

## How it works

- Each keyword check calls Bright Data's SERP API (`data_format: parsed_light`),
  which returns ~10 Google organic results per request as clean JSON — no
  HTML parsing.
- The app compares each result's hostname against your tracked domain. If
  your domain isn't found on the first page, it pages through further
  requests (`start=10`, `20`, ...) up to the **check depth** configured on
  the Settings page (10 / 30 / 50 / 100 — **10 by default**), stopping the
  moment a match is found. A keyword ranking #3 only ever costs one Bright
  Data request; a keyword that isn't ranking at all costs one request per
  page of depth configured (worst case, 10 requests at the 100 setting).
- Every check is stored as a row in `RankCheck`, so the dashboard can show a
  history/trend per keyword, not just the latest number. This includes
  failed checks (Bright Data errors, timeouts) — a null-position row is still
  recorded so "Last checked" reflects reality, rather than a failed attempt
  looking identical to "never checked."

**Cost and time tradeoff:** checking deeper means more Bright Data requests
per keyword for anything that isn't already ranking well, which uses more
credits and takes longer. **If you're on Vercel's free Hobby plan, there's a
hard ~10 second execution limit per check that Vercel itself enforces — not
something this app can override.** At depth 10 (one request), a check
comfortably fits under that. Anything deeper adds real risk of occasionally
timing out, especially under any added latency (a cold Neon database, a
slower-than-usual Bright Data response) — intermittent failures at depth 30+
on Hobby are expected, not a bug. Vercel Pro removes the ceiling entirely
(the routes already request up to 300s via `maxDuration`, which Pro honors).

**Bulk add & tags:** type multiple keywords separated by commas, or paste a
column copied from Excel/Sheets (each line becomes a separate keyword) —
either way they share the same tags/location/device. Adding more than one
skips the instant check (to avoid timing out on a big batch) — hit "Refresh
now" afterward to check them. Duplicates (same keyword/country/device/
location already tracked) are silently skipped and reported back to you.
Tags are free-form labels you can filter by using the dropdown above the
keyword table, and manage (rename/remove across all keywords at once) via
"Manage tags" next to it.

**Selecting keywords:** check the boxes next to any keywords, then use the
"Actions" menu that appears — works the same whether one or many are
selected. Beyond check/remove, it covers duplicating (as-is, or flipped to
the other device — handy for tracking desktop and mobile separately),
adding/removing tags, changing device, and moving to a different tracked
domain. Shift-click a checkbox to select every row between it and your last
click, like file managers do.

**Sorting:** click "Position" or "Last checked" in the table header to sort
by it — first click ascending, second click descending, third click back to
the default (creation order). Rows that haven't been checked yet always
sort to the end regardless of direction.

**Exporting:** "Export CSV" (above the table) offers two modes — "Latest
ranking" (one row per keyword, current snapshot) or "Full history" (one row
per recorded check, useful for charting trends elsewhere; limited to
whatever history is loaded, the last 30 checks per keyword). Both respect
the active tag filter.

**City-level targeting:** for US keywords, you can narrow to a specific
city (e.g. Los Angeles, Dallas) rather than just country-level — set a
default on the Settings page or override it per keyword. This uses Google's
`uule` location parameter under the hood; `lib/us-cities.ts` has a starter
list of major cities and is a plain array if you want to add more.

**Bright Data balance:** the Settings page shows your Bright Data account
balance once an API key is saved. This is your paid balance (USD), not the
free-tier monthly credit count (5,000/month on the free plan) — Bright Data
doesn't expose that figure through a documented public API, so check it on
their dashboard directly if you're relying on the free tier.

**Last checked time:** shown relatively ("5m ago", "3h ago", "2d ago") and
falls back to a short date once it's a week or older. Hover over it to see
the exact date and time in your local timezone. It updates live while the
tab stays open, not just on page load.

## Local setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Get a Postgres database.** Any works — [Neon](https://neon.tech) and
   [Render Postgres](https://render.com/docs/databases) both have generous
   free tiers and work identically with this app. Copy the connection string.

3. **Copy `.env.example` to `.env`** and fill in:
   - `DATABASE_URL` — your Postgres connection string
   - `CRON_SECRET` — any long random string (e.g. `openssl rand -base64 32`)

   Your Bright Data API key, zone name, and default search location are
   entered through the app itself (Settings page) once it's running — not
   env vars. The commented-out env vars in `.env.example` are only there as
   an optional fallback if you'd rather configure those two via env/CI
   instead of the UI.

4. **Push the schema to your database**
   ```bash
   npm run db:push
   ```

5. **Run it**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 — you'll see a banner prompting you to add
   your Bright Data API key and zone on the **Settings** page first. Once
   that's saved, add a domain, add a keyword, and it checks immediately so
   you'll see a result right away.

## Deploying

### Option A — Vercel

1. Push this repo to GitHub, then import it in Vercel.
2. Add the same environment variables from `.env` in Vercel's project settings.
3. `vercel.json` already defines a daily cron (`0 6 * * *` — 6am UTC) hitting
   `/api/cron/refresh`. Vercel automatically sends your `CRON_SECRET` as the
   `Authorization` header on that scheduled call — no extra config needed.
4. **Free (Hobby) plan caveat:** Hobby functions time out at 10 seconds
   regardless of `maxDuration`. With the default 100-position check depth, a
   *single* keyword check that isn't ranking at all can take longer than
   that on its own — not just the scheduled bulk refresh. If you're on
   Hobby, either drop the check depth to 10 or 30 on the Settings page, or
   upgrade to Pro (which honors the `maxDuration` values already set in the
   routes, up to 300s).

### Option B — Render

1. Push to GitHub, create a **Web Service** on Render from the repo.
   Build command: `npm run build`. Start command: `npm run start`.
2. Add the same environment variables.
3. Add Render's **Cron Job** (a separate service type) set to hit your app's
   `/api/cron/refresh?secret=YOUR_CRON_SECRET` daily via `curl`:
   ```bash
   curl "https://your-app.onrender.com/api/cron/refresh?secret=$CRON_SECRET"
   ```
   Render's cron jobs aren't limited to 10 seconds the way Vercel Hobby is,
   so this is the more comfortable option for a larger keyword list.

Either way, you can also just click **"Refresh now"** on a domain's page any
time — it doesn't wait for the schedule.

## Search Console

Separate from Bright Data rank checks — this pulls clicks, impressions, CTR,
and average position directly from Google, including Discover performance
(traffic from Google's Discover feed, not regular search).

**What connecting it unlocks:**

- **Inline metrics on tracked keywords** — each keyword's row in the table
  shows real clicks and impressions from the last 30 days (when Search
  Console has data for that exact query), right next to the position Bright
  Data found. Hover the small text for the full breakdown (CTR, avg.
  position).
- **"Keywords you already rank for"** — a collapsible section on each
  domain's page, below the keyword table, listing queries Search Console
  shows you getting clicks on that *aren't* in your tracked list yet, sorted
  by clicks. One click adds any of them to tracking.
- **The `/search-console` page** — clicks/impressions/CTR/position over the
  last 7/30/90 days, grouped by query, page, date, country, or device.
- **Weekly email digest** — top queries from the last 7 days, sent every
  Monday, if you set it up (needs a [Resend](https://resend.com) API key —
  free tier is enough for this).

Each account connects its own Google Search Console using its own Google
Cloud OAuth client — same "bring your own credentials" pattern as Bright
Data, entered on the Settings page.

**One-time setup (per Google account you want to connect):**

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create or pick a project.
2. **APIs & Services → Library** → search "Search Console API" → Enable.
3. **APIs & Services → OAuth consent screen** → configure it (External is fine for personal/small-team use), add the `.../auth/webmasters.readonly` scope, and add yourself as a test user if it's in Testing mode.
4. **APIs & Services → Credentials → Create Credentials → OAuth Client ID** → Application type: **Web application** → under Authorized redirect URIs, add:
   ```
   https://your-deployed-domain.com/api/google/callback
   ```
   (and `http://localhost:3000/api/google/callback` too if you want to test locally).
5. Copy the Client ID and Client Secret into Settings → Search Console in the app, save, then click **Connect Search Console**.
6. Pick which verified property to track from the list Google returns.

**Note on the "unverified app" warning:** while your OAuth consent screen is in Testing mode (the default), Google shows an interstitial warning during the connect step since the app hasn't been through Google's verification review. For personal or small-team use this is expected — click "Advanced" → "Go to (your app name)" to proceed. It only affects the consent screen's appearance, not functionality.

**Discover/News data limitation (from Google, not this app):** Google's API doesn't support grouping Discover or News data by search query — only by page, date, country, or device. The insights page switches away from "By query" automatically when you pick Discover or News, since Google's API rejects that combination outright.

**Weekly digest setup:** sign up at resend.com (free), grab an API key, paste it into Settings along with the recipient email, and check "Send me a weekly digest." It sends via Resend's shared sandbox address by default — no domain verification needed to get started. Runs every Monday at 13:00 UTC via a second Vercel Cron entry already in `vercel.json`.

## Google Ads (keyword volume, keyword ideas)

**Not built yet.** Real search-volume data lives in Google Ads' Keyword
Planner, which requires a Google Ads account and a **developer token**
approved manually by Google — a review process, not a self-serve API key.
Building against this before you have access risks shipping something you
can't actually use. Once you have a developer token, this is a natural
next addition: a "Research" page for ad-hoc keyword lookup, keyword idea
generation seeded from your site content/tracked keywords/Search Console
queries, and monthly search volume shown alongside tracked keywords.

## Extending

- **More history / different chart range:** `checks` are fetched with
  `take: 30` in `app/domains/[id]/page.tsx` and `app/api/domains/[id]/route.ts`
  — raise that if you want a longer trend line.
- **Other search engines / countries:** `lib/brightdata.ts` passes `gl`/`hl`
  straight through to Google; Bright Data also supports Bing, Yandex, etc. if
  you want to add an `engine` field per keyword later.
- **Email alerts on position changes:** not built in yet — `lib/rank.ts` is
  the natural place to add a comparison + notification step after each check.
- **Auth:** this MVP has no login — it assumes a private deployment. Add
  Vercel/Render access controls or a simple password gate if you're exposing
  it publicly.
