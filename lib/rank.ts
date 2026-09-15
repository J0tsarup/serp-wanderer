import { prisma } from "./db";
import { fetchSerp, findRanking, BrightDataError } from "./brightdata";
import { getSettings } from "./settings";

export type CheckOutcome = {
  keywordId: string;
  term: string;
  position: number | null;
  url: string | null;
  error?: string;
};

// Small pause between page requests for the same keyword — gentle on rate
// limits, and pointless to remove since each request already takes ~1s+.
const PAGE_DELAY_MS = 300;

/**
 * Check a single keyword against Bright Data and persist the result.
 * Never throws — errors are captured in the returned outcome so a batch
 * run can continue past individual failures.
 *
 * Pages through Google's results (10 per page) up to the configured
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

    const { brightdataApiKey, brightdataZone, maxCheckDepth } = await getSettings(keyword.domain.userId);
    const maxPages = Math.max(1, Math.ceil(maxCheckDepth / 10));

    let result: { position: number; url: string } | null = null;

    for (let page = 0; page < maxPages; page++) {
      const serp = await fetchSerp({
        apiKey: brightdataApiKey,
        zone: brightdataZone,
        keyword: keyword.term,
        country: keyword.country,
        language: keyword.language,
        device: keyword.device as "desktop" | "mobile",
        location: keyword.location,
        page,
      });

      result = findRanking(serp, keyword.domain.name, page * 10);
      if (result) break; // found it — no need to check further pages

      if (serp.organic.length === 0) break; // Google has no more results to page through

      if (page < maxPages - 1) {
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      }
    }

    await prisma.rankCheck.create({
      data: {
        keywordId: keyword.id,
        position: result?.position ?? null,
        url: result?.url ?? null,
      },
    });

    return {
      keywordId: keyword.id,
      term: keyword.term,
      position: result?.position ?? null,
      url: result?.url ?? null,
    };
  } catch (err) {
    // Always log the real error server-side — a bare "Unknown error" client
    // message with nothing in Vercel's logs made this genuinely undebuggable
    // before. A request that got killed by the platform's own execution
    // timeout (rather than thrown inside our own code) surfaces here as an
    // AbortError, which is real and worth surfacing distinctly.
    console.error(`checkKeyword failed for "${keyword.term}" (${keyword.id}):`, err);

    let message = "Unknown error";
    if (err instanceof BrightDataError) {
      message = err.message;
    } else if (err instanceof Error) {
      message =
        err.name === "AbortError" || err.name === "TimeoutError"
          ? "Timed out waiting on Bright Data — try a lower check depth in Settings if this keeps happening."
          : err.message;
    }
    return { keywordId: keyword.id, term: keyword.term, position: null, url: null, error: message };
  }
}

/**
 * Check every tracked keyword, sequentially with a small delay to stay
 * comfortably under Bright Data's rate limits. Used by the daily cron route
 * and the "refresh all" button.
 */
export async function checkAllKeywords(): Promise<CheckOutcome[]> {
  const keywords = await prisma.keyword.findMany({ select: { id: true } });
  const outcomes: CheckOutcome[] = [];

  for (const { id } of keywords) {
    outcomes.push(await checkKeyword(id));
    // Small stagger so a large keyword list doesn't fire concurrently.
    await new Promise((r) => setTimeout(r, 250));
  }

  return outcomes;
}
