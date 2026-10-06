import { prisma } from "./db";
import { getSettings } from "./settings";
import { fetchSerpPage, providerLabel } from "./serp";
import { rankItems } from "./serp/match";
import {
  decodeLink,
  hostMatches,
  isResolvableRedirect,
  itemHost,
  resolveGoogleRedirect,
  urlFromDisplay,
  SerpItem,
} from "./serp/resolve";
import { SerpProviderError } from "./serp/errors";
import type { SerpSnapshot, SerpSnapshotItem } from "./serp/snapshot";

export type CheckOutcome = {
  keywordId: string;
  term: string;
  position: number | null;
  url: string | null;
  error?: string;
  // The failure is likely to hit every keyword right now (outage, block, bad
  // credentials) — batches stop after a few of these in a row.
  systemic?: boolean;
};

// Stop a batch after this many systemic failures in a row: when the provider
// is down or Google is blocking, carrying on just burns time (and maybe credits).
export const HALT_AFTER_CONSECUTIVE_FAILURES = 3;

// Small pause between page requests for the same keyword — gentle on rate
// limits, and pointless to remove since each request already takes ~1s+.
const PAGE_DELAY_MS = 300;

/**
 * The real URL for a matched result. Same rule for every provider:
 * a readable link is used directly; an opaque Google redirect (/goto?url=…)
 * is resolved for this one result only; if that fails, the display URL is
 * turned into a best-effort address so the row still shows which page ranked.
 */
async function resolveMatchedUrl(item: SerpItem): Promise<string | null> {
  const direct = decodeLink(item.link);
  if (direct) return direct;
  if (isResolvableRedirect(item.link)) {
    const resolved = await resolveGoogleRedirect(item.link);
    if (resolved) return resolved;
  }
  return urlFromDisplay(item.displayUrl);
}

/**
 * Check a single keyword with the user's selected SERP provider and persist
 * the result. Never throws — errors are captured in the returned outcome
 * (and stored on the check) so a batch run can continue past failures.
 *
 * Pages through Google's results (≈10 per page) up to the configured
 * maxCheckDepth, stopping as soon as a match is found — so a keyword
 * ranking #3 only costs one request, not ten.
 */
export async function checkKeyword(keywordId: string): Promise<CheckOutcome> {
  const keyword = await prisma.keyword.findUnique({
    where: { id: keywordId },
    include: { domain: true },
  });
  if (!keyword) {
    return { keywordId, term: "", position: null, url: null, error: "Keyword not found" };
  }

  let providerName = "the SERP provider";

  try {
    if (!keyword.domain.userId) {
      return {
        keywordId: keyword.id,
        term: keyword.term,
        position: null,
        url: null,
        error: "This domain isn't linked to an account yet.",
      };
    }

    const settings = await getSettings(keyword.domain.userId);
    providerName = providerLabel(settings.serpProvider);
    const maxPages = Math.max(1, Math.ceil(settings.maxCheckDepth / 10));

    let result: { position: number; url: string | null } | null = null;
    // Organic results seen on earlier pages. Google's pages don't always hold
    // exactly 10 organic results, so positions on page 2+ are counted from
    // what was actually returned rather than assumed as page * 10.
    let seenBefore = 0;
    // Every organic result looked at, for the keyword's results panel.
    const scanned: SerpSnapshotItem[] = [];

    for (let page = 0; page < maxPages; page++) {
      let items;
      try {
        ({ items } = await fetchSerpPage(settings, {
          keyword: keyword.term,
          country: keyword.country,
          language: keyword.language,
          device: keyword.device === "mobile" ? "mobile" : "desktop",
          location: keyword.location,
          page,
        }));
      } catch (err) {
        // Say how far the check got, so a failure on a deep page doesn't
        // read the same as one on the first page.
        if (page > 0 && err instanceof SerpProviderError) {
          throw new SerpProviderError(
            `Not in the top ${seenBefore} results; page ${page + 1} then failed — ${err.message}`,
            err.status,
            { systemic: err.systemic }
          );
        }
        throw err;
      }

      const ranked = rankItems(items, seenBefore);
      for (const { item, position } of ranked) {
        const host = itemHost(item);
        const url = decodeLink(item.link);
        scanned.push({
          position,
          title: item.title ?? "",
          host,
          url,
          link: url ?? item.link,
          display: item.displayUrl ?? null,
          isTarget: hostMatches(host, keyword.domain.name),
        });
      }

      const match = ranked.find((r) => hostMatches(itemHost(r.item), keyword.domain.name));
      if (match) {
        result = { position: match.position, url: await resolveMatchedUrl(match.item) };
        const entry = scanned.find((s) => s.isTarget && s.position === match.position);
        if (entry && result.url) {
          entry.url = result.url;
          entry.link = result.url;
        }
        break; // found it — no need to check further pages
      }

      if (items.length === 0) {
        if (page === 0) {
          // An empty first page almost always means the page wasn't parsed
          // (layout change, block page) rather than "zero results on Google" —
          // record it as a failure instead of "not ranking".
          throw new SerpProviderError(
            `${providerName} returned no organic results for this keyword — the results page may not have loaded or parsed correctly.`
          );
        }
        break; // Google has no more results to page through
      }
      seenBefore += items.length;

      if (page < maxPages - 1) {
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      }
    }

    const snapshot: SerpSnapshot = {
      checkedAt: new Date().toISOString(),
      provider: providerName,
      items: scanned,
      scanned: scanned.length,
      depth: settings.maxCheckDepth,
      found: !!result,
    };

    await prisma.$transaction([
      prisma.rankCheck.create({
        data: {
          keywordId: keyword.id,
          position: result?.position ?? null,
          url: result?.url ?? null,
        },
      }),
      prisma.keyword.update({
        where: { id: keyword.id },
        data: { serpSnapshot: snapshot as unknown as object },
      }),
    ]);

    return {
      keywordId: keyword.id,
      term: keyword.term,
      position: result?.position ?? null,
      url: result?.url ?? null,
    };
  } catch (err) {
    // Always log the real error server-side. A request killed by a timeout
    // surfaces here as an AbortError/TimeoutError, worth naming distinctly.
    console.error(`checkKeyword failed for "${keyword.term}" (${keyword.id}):`, err);

    let message = "Unknown error";
    const systemic = err instanceof SerpProviderError ? err.systemic : true;
    if (err instanceof SerpProviderError) {
      message = err.message;
    } else if (err instanceof Error) {
      message =
        err.name === "AbortError" || err.name === "TimeoutError"
          ? `Timed out waiting on ${providerName} — it may be slow or having an outage.`
          : err.message;
    }

    // Record the attempt even though it failed, so "Last checked" reflects
    // reality and the table can show "Check failed" instead of "not ranking".
    await prisma.rankCheck
      .create({ data: { keywordId: keyword.id, position: null, url: null, error: message.slice(0, 500) } })
      .catch((dbErr: unknown) => console.error(`Failed to record failed-check attempt for ${keyword.id}:`, dbErr));

    return { keywordId: keyword.id, term: keyword.term, position: null, url: null, error: message, systemic };
  }
}

/**
 * Batched refresh: checks the keywords that have gone longest without a
 * check, oldest first (never-checked first of all), and stops when the time
 * budget runs out — so one run never tries to do more than fits in a single
 * function invocation. Keywords checked within `freshForMs` are skipped, which
 * makes running this several times a day safe: each run just picks up where
 * the last left off, and nothing is paid for twice.
 */
export async function checkStaleKeywords(opts: {
  budgetMs: number;
  freshForMs: number;
  userId?: string;
  domainId?: string;
}): Promise<{ outcomes: CheckOutcome[]; remaining: number; halted: string | null }> {
  const started = Date.now();
  const keywords = await prisma.keyword.findMany({
    where: {
      ...(opts.domainId ? { domainId: opts.domainId } : {}),
      ...(opts.userId ? { domain: { userId: opts.userId } } : { domain: { userId: { not: null } } }),
    },
    select: { id: true, checks: { orderBy: { checkedAt: "desc" }, take: 1, select: { checkedAt: true } } },
  });

  const cutoff = Date.now() - opts.freshForMs;
  const due = keywords
    .map((k) => ({ id: k.id, last: k.checks[0]?.checkedAt.getTime() ?? 0 }))
    .filter((k) => k.last < cutoff)
    .sort((a, b) => a.last - b.last);

  const outcomes: CheckOutcome[] = [];
  const skipped = new Set<string>();
  // Rough per-check cost so we don't start one we can't finish. Grows with
  // what we observe, so deep checks naturally leave more headroom.
  let slowest = 15_000;
  let failStreak = 0;
  let halted: string | null = null;

  for (const { id } of due) {
    if (Date.now() - started + slowest > opts.budgetMs) break;
    // Vercel can occasionally deliver the same cron run twice; skip anything
    // another run checked since this list was built.
    const latest = await prisma.rankCheck.findFirst({
      where: { keywordId: id, checkedAt: { gte: new Date(cutoff) } },
      select: { id: true },
    });
    if (latest) {
      skipped.add(id);
      continue;
    }
    const t0 = Date.now();
    const outcome = await checkKeyword(id);
    outcomes.push(outcome);
    slowest = Math.max(slowest, Date.now() - t0);
    failStreak = outcome.error && outcome.systemic ? failStreak + 1 : 0;
    if (failStreak >= HALT_AFTER_CONSECUTIVE_FAILURES) {
      halted = `Stopped after ${failStreak} failed checks in a row — last error: ${outcome.error}`;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Remaining = still due and not checked by this run.
  const done = new Set([...outcomes.map((o) => o.keywordId), ...skipped]);
  return { outcomes, remaining: due.filter((k) => !done.has(k.id)).length, halted };
}
