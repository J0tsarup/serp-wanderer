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
export async function fetchSerp(params: {
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
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new BrightDataError(
      `Bright Data request failed (${resp.status}): ${body.slice(0, 300)}`,
      resp.status
    );
  }

  let raw: unknown;
  try {
    raw = await resp.json();
  } catch {
    // A response that returned resp.ok but fails to parse as JSON almost
    // always means the connection was cut mid-response — usually the
    // platform's own execution timeout killing the request, not Bright
    // Data itself. Surface that plainly instead of the raw parse error.
    throw new BrightDataError(
      "Bright Data's response was empty or cut off — this usually means the request timed out. Try a lower check depth in Settings."
    );
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
