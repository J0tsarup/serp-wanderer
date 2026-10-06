// Reads organic results out of a raw Google results page. Shared by every
// provider that can hand back HTML (Scraping Robot always; Bright Data when
// its JSON parsing doesn't come through).
import * as cheerio from "cheerio";
import type { SerpItem } from "./resolve";

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
