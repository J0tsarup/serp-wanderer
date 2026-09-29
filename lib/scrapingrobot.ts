// Client for Scraping Robot's HTML API (https://scrapingrobot.readme.io/reference/post_).
//
// Scraping Robot returns the raw Google results page, so this file builds the
// Google URL, fetches it through Scraping Robot, and parses organic results
// out of the HTML into SerpItem — after which ranking and link handling are
// the same shared code every provider uses (./serp/*).
//
// Signed-out Google pages link results through /goto?url=<opaque token>,
// which doesn't contain the destination; that's handled in ./serp/resolve.ts
// by matching on the display URL and resolving only the matched link.

import * as cheerio from "cheerio";
import { SerpProviderError } from "./serp/errors";
import type { SerpItem } from "./serp/resolve";
import { encodeUule } from "./serp/uule";

const ENDPOINT = "https://api.scrapingrobot.com/";

export function buildGoogleUrl(params: {
  keyword: string;
  country: string;
  language: string;
  location?: string | null;
  page?: number;
}): string {
  const sp = new URLSearchParams({ q: params.keyword, gl: params.country, hl: params.language, pws: "0" });
  if (params.page && params.page > 0) sp.set("start", String(params.page * 10));
  let url = `https://www.google.com/search?${sp.toString()}`;
  // Google itself (unlike Bright Data) needs uule in its encoded form. Added
  // by hand: the "w+" prefix is conventionally sent with a literal "+".
  if (params.location) url += `&uule=${encodeUule(params.location)}`;
  return url;
}

export async function fetchSerpScrapingRobot(params: {
  token: string | null;
  render: boolean;
  keyword: string;
  country: string;
  language: string;
  device?: "desktop" | "mobile";
  location?: string | null;
  page?: number;
}): Promise<{ items: SerpItem[] }> {
  if (!params.token) {
    throw new SerpProviderError("Scraping Robot isn't configured yet — add your API token on the Settings page.");
  }
  if (params.device === "mobile") {
    // Scraping Robot's documented API has no way to request Google's mobile
    // results, so a "mobile" check would silently be a desktop one.
    throw new SerpProviderError(
      "Mobile checks aren't supported with Scraping Robot — switch this keyword to desktop, or use Bright Data for mobile."
    );
  }

  const resp = await fetch(`${ENDPOINT}?token=${encodeURIComponent(params.token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: buildGoogleUrl(params),
      module: params.render ? "HtmlChromeScraper" : "HtmlRequestScraper",
    }),
    signal: AbortSignal.timeout(params.render ? 60_000 : 30_000),
  });

  const text = await resp.text().catch(() => "");

  if (!resp.ok) {
    const reason =
      resp.status === 401
        ? "token is wrong or the account is out of credits"
        : resp.status === 429
        ? "Scraping Robot is overloaded — try again shortly"
        : resp.status === 500
        ? "Scraping Robot timed out or hit an internal error"
        : text.slice(0, 200);
    throw new SerpProviderError(`Scraping Robot request failed (${resp.status}): ${reason}`, resp.status);
  }

  const html = extractHtml(text);
  if (!html) {
    throw new SerpProviderError("Scraping Robot returned an empty page.");
  }
  if (/\/sorry\/|unusual traffic|detected unusual/i.test(html)) {
    throw new SerpProviderError("Google showed a CAPTCHA / block page for this request — try again, or enable JS rendering.");
  }

  return { items: parseGoogleHtml(html) };
}

/** Response is either raw HTML or JSON wrapping it (`{ status, result, ... }`) — accept both. */
function extractHtml(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as { result?: unknown; status?: string; error?: string; message?: string };
      if (typeof data.result === "string") return data.result;
      if (data.status && data.status !== "SUCCESS") {
        throw new SerpProviderError(`Scraping Robot: ${data.error || data.message || data.status}`);
      }
    } catch (err) {
      if (err instanceof SerpProviderError) throw err;
    }
  }
  return trimmed || null;
}

function isAdOrInternal(href: string): boolean {
  try {
    const u = new URL(href, "https://www.google.com");
    const googleish = /(^|\.)google\.[a-z.]+$/i.test(u.hostname);
    if (/googleadservices\.com$/i.test(u.hostname)) return true;
    if (!googleish) return false;
    // Google links that are NOT result redirects: other searches, images, maps, ads.
    return !(u.pathname === "/url" || u.pathname === "/goto");
  } catch {
    return true;
  }
}

/**
 * Extracts organic results from a Google results page. Works on both the
 * full (JS) layout and the basic signed-out layout: every organic result is
 * a link wrapping an <h3> title, with the display URL in a nearby <cite>
 * (full layout) or as text inside the same link (basic layout). Ads live in
 * #tads / #bottomads and are skipped.
 */
export function parseGoogleHtml(html: string): SerpItem[] {
  const $ = cheerio.load(html);
  const items: SerpItem[] = [];
  const seen = new Set<string>();

  $("a:has(h3)").each((_, el) => {
    const a = $(el);
    const href = a.attr("href");
    if (!href || isAdOrInternal(href)) return;
    if (a.closest("#tads, #tadsb, #bottomads, [data-text-ad], [aria-label='Ads']").length) return;
    if (seen.has(href)) return;

    const title = a.find("h3").first().text().trim();

    // Display URL: a <cite> in the same result block, else the link's own
    // text minus the title (basic layout puts the breadcrumb there).
    let displayUrl: string | null = null;
    let node = a;
    for (let depth = 0; depth < 5 && !displayUrl; depth++) {
      const cite = node.find("cite").first().text().trim();
      if (cite) displayUrl = cite;
      node = node.parent();
    }
    if (!displayUrl) {
      const ownText = a.text().replace(title, "").trim();
      displayUrl = ownText || null;
    }

    seen.add(href);
    items.push({ link: href.startsWith("/") ? `https://www.google.com${href}` : href, title, displayUrl });
  });

  return items;
}
