// Thin client around Bright Data's SERP API (https://docs.brightdata.com/scraping-automation/serp-api)
//
// Uses data_format=parsed_light, which returns ~10 organic Google results per
// request as clean JSON — no HTML parsing needed. Checking beyond position 10
// means paging with Google's `start` param (start=10, 20, ...) across
// multiple requests — see checkKeyword in ./rank.ts, which drives this via
// the `page` argument below. Results are normalized to SerpItem so ranking
// and link handling (./serp/*) are shared with every other provider.

import { SerpProviderError } from "./serp/errors";
import type { SerpItem } from "./serp/resolve";

type OrganicResult = {
  link: string;
  title: string;
  description?: string;
  display_link?: string;
  rank?: number; // position within the organic results
  global_rank?: number; // position across every SERP element (ads, snippets, ...) — not used
};

/** Kept as a named subclass so existing `instanceof` checks still read clearly. */
export class BrightDataError extends SerpProviderError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "BrightDataError";
  }
}

/**
 * Fetch Google search results for a single keyword via Bright Data's SERP API.
 * Credentials are passed in explicitly (rather than read internally) since
 * they're per-user — the caller resolves whose credentials to use.
 */
// Bright Data is usually quick but has had slow spells and short outages.
// One retry on a timeout / cut-off / 5xx turns a brief hiccup into a few
// seconds' delay instead of a failed check.
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 2;

export async function fetchSerp(params: Parameters<typeof fetchSerpOnce>[0]): Promise<{ items: SerpItem[] }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchSerpOnce(params);
    } catch (err) {
      lastErr = err;
      const transient =
        (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) ||
        (err instanceof BrightDataError && err.retryable);
      if (!transient || attempt === MAX_ATTEMPTS) break;
      console.warn(`Bright Data attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying:`, err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (lastErr instanceof Error && (lastErr.name === "TimeoutError" || lastErr.name === "AbortError")) {
    throw new BrightDataError(
      `Bright Data didn't answer within ${REQUEST_TIMEOUT_MS / 1000}s (tried ${MAX_ATTEMPTS} times) — it may be having an outage.`
    );
  }
  throw lastErr;
}

async function fetchSerpOnce(params: {
  apiKey: string | null;
  zone: string | null;
  keyword: string;
  country: string; // "gl" — e.g. "us"
  language: string; // "hl" — e.g. "en"
  device?: "desktop" | "mobile";
  location?: string | null; // optional city-level targeting (Google Ads canonical geo-target name), sent as Google's `uule` param
  page?: number; // 0-indexed page of results; page 1 = results 10-19, etc.
}): Promise<{ items: SerpItem[] }> {
  const { apiKey, zone } = params;
  if (!apiKey || !zone) {
    throw new BrightDataError(
      "Bright Data isn't configured yet — add your API key and zone name on the Settings page."
    );
  }

  const searchParams = new URLSearchParams({
    q: params.keyword,
    gl: params.country,
    hl: params.language,
  });
  if (params.device === "mobile") {
    searchParams.set("brd_mobile", "1");
  }
  if (params.location) {
    searchParams.set("uule", params.location);
  }
  if (params.page && params.page > 0) {
    searchParams.set("start", String(params.page * 10));
  }

  const googleUrl = `https://www.google.com/search?${searchParams.toString()}`;

  const resp = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      zone,
      url: googleUrl,
      format: "raw",
      data_format: "parsed_light",
    }),
    // Bright Data SERP responses are usually sub-second but can occasionally
    // take longer under load; give it real room before giving up.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new BrightDataError(`Bright Data request failed (${resp.status}): ${body.slice(0, 300)}`, resp.status);
    err.retryable = resp.status === 429 || resp.status >= 500;
    throw err;
  }

  let raw: unknown;
  try {
    raw = await resp.json();
  } catch {
    // A response that returned resp.ok but fails to parse as JSON almost
    // always means the connection was cut mid-response — usually the
    // platform's own execution timeout killing the request, not Bright
    // Data itself. Surface that plainly instead of the raw parse error.
    const err = new BrightDataError(
      "Bright Data's response was empty or cut off — it was probably too slow to answer. This is usually a Bright Data slowdown or outage."
    );
    err.retryable = true;
    throw err;
  }
  // Bright Data has been observed returning either a plain object with an
  // `organic` array, or that same object wrapped in a single-element array
  // — handle both rather than assuming one shape.
  const data = Array.isArray(raw) ? raw[0] : (raw as { organic?: unknown[] } | null);
  const organic = ((data?.organic as OrganicResult[]) ?? []).filter((r) => r && typeof r.link === "string");
  return {
    items: organic.map((r) => ({
      link: r.link,
      title: r.title,
      displayUrl: r.display_link ?? null,
      rank: r.rank, // organic rank only — see findRanking in ./serp/match.ts
    })),
  };
}
