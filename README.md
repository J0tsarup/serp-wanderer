# SERP Wanderer

A small, self-hosted keyword rank tracker: add domains, add keywords per domain,
and it checks Google positions on a schedule (or on demand) using either
**Bright Data's SERP API** or **Scraping Robot** — pick one in Settings.
Positions are stored over time so you get a trend line per keyword — a
lightweight SerpBear-style dashboard.

## Layout

A persistent sidebar (desktop) or domain-switcher dropdown (mobile) replaces
navigating back to a domain list page — pick a domain once and it stays
selected while you work. Adding a keyword is a button that opens a small
dialog instead of a permanent form bar. The keyword table becomes stacked
cards below the `md` breakpoint instead of a horizontally-scrolling grid.
Settings is tabbed (Rank checks / Search Console / Email digest) instead of
one long scrolling page.

## Accounts

The app is multi-user: each account has its own domains, keywords, and
provider credentials — nobody sees anyone else's data. Sign up at `/signup`
with a username, password, and the **invite code** set in the
`SIGNUP_INVITE_CODE` environment variable (keep the code in Vercel's env vars,
not in the repo). If that variable isn't set, only the very first account can
sign up and signups close after that. Log in at `/login`.

**Upgrading to 3.3:** adds the Scraping Robot provider and a Search Console
property per domain. Run `npm run db:push`, or paste this into Neon's SQL
editor **before** deploying (it's additive, so the old version keeps working
while it's in place; the first line is the 3.2 change, harmless if already
applied):

```sql
ALTER TABLE "RankCheck" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "serpProvider" TEXT NOT NULL DEFAULT 'brightdata';
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "scrapingRobotToken" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "scrapingRobotRender" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Domain" ADD COLUMN IF NOT EXISTS "gscSiteUrl" TEXT;
```

Then set `SIGNUP_INVITE_CODE` in Vercel → Settings → Environment Variables.

**Upgrading an existing deployment:** if you were already running this
before accounts existed, the very first account you sign up automatically
takes ownership of whatever domains/keywords/settings already existed — no
manual data migration needed beyond running the SQL migration below.

## How it works

- Each keyword check fetches one page (≈10 organic results) of Google
  results from the provider chosen in Settings:
  - **Bright Data** (`data_format: parsed_light`) returns results as JSON with
    real links.
  - **Scraping Robot** returns the raw Google page, which the app parses
    (`lib/scrapingrobot.ts`). Desktop only — its API has no way to request
    Google's mobile results, so mobile keywords report a clear error there.
    City targeting is sent as Google's encoded `uule`.
- **Finding your site in the results — same for every provider**
  (`lib/serp/resolve.ts`): real links are used directly; old-style Google
  redirects (`/url?q=…`) are decoded; Google's newer signed-out redirects
  (`/goto?url=<opaque token>`) contain no readable address, so the site is
  identified from the address Google prints under each result
  (`hardypaw.com › products`). Only the result that matches your domain then
  has its real URL looked up — one extra request, not one per result — and
  if Google won't answer that, the ranking URL is rebuilt from the printed
  address.
- If your domain isn't on the first page, it pages through further requests
  (`start=10`, `20`, …) up to the **check depth** in Settings (10 / 30 / 50 /
  100 — **10 by default**), stopping the moment a match is found. Positions
  on later pages count the organic results actually returned, not an assumed
  10 per page. Bright Data's organic `rank` is used, not `global_rank`
  (which counts ads and other SERP features too).
- Every check is stored in `RankCheck`, including failed ones — those carry
  an `error`, so the table shows "Check failed" instead of "not ranking."

**Refreshes run in batches.** Vercel functions can now run up to 300s on
every plan including Hobby (with Fluid compute, on by default), but a big
keyword list still wouldn't fit in one run. So:

- The scheduled refresh checks the keywords that have gone longest without a
  check, stops with time to spare, and leaves the rest for the next run.
  `vercel.json` schedules it four times a day (Hobby allows each cron entry
  once a day, so it's four entries); keywords checked in the last 20 hours
  are skipped, so nothing is checked or paid for twice. Roughly 80–100
  keywords fit per run at depth 10.
- "Refresh now" checks a domain in short batches and shows how many are
  left; selecting keywords → Check does the same in groups of five.

**Cost:** deeper checks mean more provider requests for keywords that aren't
already ranking well, so more credits and time per keyword.

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

   Your provider credentials (Bright Data key + zone, or Scraping Robot token) and default search location are
   entered through the app itself (Settings page) once it's running — not
   env vars. The commented-out env vars in `.env.example` are only there as
   an optional fallback if you'd rather configure those via env/CI
   instead of the UI.

4. **Push the schema to your database**
   ```bash
   npm run db:push
   ```

5. **Run it**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 — you'll see a banner prompting you to pick a
   provider and add its credentials on the **Settings** page first. Once
   that's saved, add a domain, add a keyword, and it checks immediately so
   you'll see a result right away.

## Deploying

### Option A — Vercel

1. Push this repo to GitHub, then import it in Vercel.
2. Add the same environment variables from `.env` in Vercel's project settings.
3. `vercel.json` already schedules `/api/cron/refresh` four times a day
   (02:00, 08:00, 14:00, 20:00 UTC — same path, four entries; Hobby may run each up to an hour late) and
   the weekly digest. Vercel automatically sends your `CRON_SECRET` as the
   `Authorization` header on those calls — no extra config needed.
4. Add `SIGNUP_INVITE_CODE` to the environment variables.

### Option B — Render

1. Push to GitHub, create a **Web Service** on Render from the repo.
   Build command: `npm run build`. Start command: `npm run start`.
2. Add the same environment variables.
3. Add Render's **Cron Job** (a separate service type) set to hit your app's
   `/api/cron/refresh?secret=YOUR_CRON_SECRET` daily via `curl`:
   ```bash
   curl "https://your-app.onrender.com/api/cron/refresh?secret=$CRON_SECRET"
   ```
   Run it as often as you like (e.g. hourly) — each run only checks keywords
   that are due, so extra runs cost nothing.

Either way, you can also just click **"Refresh now"** on a domain's page any
time — it doesn't wait for the schedule.

## Search Console

Separate from rank checks — this pulls clicks, impressions, CTR,
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

**Property per domain:** each domain's page shows which Search Console
property feeds it, with a "change" link to pick one. If none is picked, the
account's property (chosen in Settings) is used only when it covers that
domain — a `sc-domain:hardypaw.com` property covers hardypaw.com and its
subdomains; a URL-prefix property like `https://www.hardypaw.com/` matches
on hostname. Other domains show no Search Console columns rather than
another site's numbers. Query data is cached for an hour per property.

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

**Weekly digest setup:** sign up at resend.com (free), grab an API key, paste it into Settings along with the recipient email, and check "Send me a weekly digest." It sends via Resend's shared sandbox address by default — no domain verification needed to get started. Runs every Monday at 13:00 UTC via its own Vercel Cron entry already in `vercel.json`.

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
- **Another SERP provider:** add a client that returns `SerpItem[]` (see
  `lib/serp/resolve.ts`) and a branch in `lib/serp/index.ts` — ranking and
  link handling are shared, so that's all it needs.
