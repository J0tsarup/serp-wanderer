// Thin client around Bright Data's SERP API (https://docs.brightdata.com/scraping-automation/serp-api)
//
// Uses data_format=parsed_light, which returns ~10 organic Google results per
// request as clean JSON — no HTML parsing needed. Checking beyond position 10
// means paging with Google's `start` param (start=10, 20, ...) across
// multiple requests — see checkKeyword in ./rank.ts, which drives this via
// the `page` argument below.

export type OrganicResult = {
  link: string;
  title: string;
  description?: string;
  rank?: number;
  global_rank?: number;
};

export type SerpResult = {
  organic: OrganicResult[];
};

export class BrightDataError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "BrightDataError";
    this.status = status;
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
}): Promise<SerpResult> {
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
  return { organic: (data?.organic as OrganicResult[]) ?? [] };
}

/**
 * Extract a bare hostname for comparison, e.g.
 * "https://www.hardypaw.com/products/x" -> "hardypaw.com"
 */
function bareHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/**
 * Given SERP results and a target domain, find the best-ranking match.
 * Returns null if the domain doesn't appear in the fetched results.
 *
 * Position is read from `global_rank` or `rank` (Bright Data has been
 * observed using either depending on the request). If neither field is
 * present, falls back to the result's position in the array, offset by
 * `pageOffset` so page 2+ results still number correctly (11, 12, ... not
 * restarting at 1).
 */
export function findRanking(
  serp: SerpResult,
  targetDomain: string,
  pageOffset = 0
): { position: number; url: string } | null {
  const target = targetDomain.toLowerCase().replace(/^www\./, "");

  const ranked = serp.organic.map((r, i) => ({
    ...r,
    position: r.global_rank ?? r.rank ?? pageOffset + i + 1,
  }));

  const match = ranked.sort((a, b) => a.position - b.position).find((r) => bareHost(r.link) === target);

  if (!match) return null;
  return { position: match.position, url: match.link };
}
