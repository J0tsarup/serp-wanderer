// Provider-agnostic handling of Google result links. Every SERP provider
// (Bright Data, Scraping Robot, any future one) normalizes its results into
// SerpItem and goes through here, so the same rules apply everywhere:
//
// 1. A real http(s) link to a non-Google site -> use it directly.
// 2. A classic Google redirect (/url?q=... or /url?url=...) -> decode the
//    destination out of the link. No request needed.
// 3. Google's newer signed-out redirect (/goto?url=<opaque token>) carries
//    no readable destination, so the site is identified from the display
//    URL Google prints under each result ("hardypaw.com › products").
//    Only the result that matches the tracked domain then gets its real URL
//    resolved (one extra request, not one per result) — see resolveGoogleRedirect.

export type SerpItem = {
  link: string; // href as returned by the provider — may be a Google redirect
  displayUrl?: string | null; // visible breadcrumb/cite text, e.g. "https://www.hardypaw.com › products › x"
  title?: string;
  rank?: number; // provider's organic position, if it gives one
};

const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/i;

export function bareHost(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  return h.startsWith("www.") ? h.slice(4) : h;
}

function tryUrl(value: string, base = "https://www.google.com"): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/** Is this a Google-hosted link (redirect, search, etc.) rather than a destination? */
function isGoogleUrl(u: URL): boolean {
  return GOOGLE_HOST.test(u.hostname);
}

/**
 * Turns whatever the provider gave into a destination URL if one can be
 * read without a network request. Returns null for opaque redirects
 * (/goto?url=...) and other Google-internal links.
 */
export function decodeLink(link: string): string | null {
  const u = tryUrl(link);
  if (!u) return null;
  if (!isGoogleUrl(u)) return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;

  if (u.pathname === "/url") {
    const dest = u.searchParams.get("q") || u.searchParams.get("url");
    const d = dest ? tryUrl(dest) : null;
    if (d && !isGoogleUrl(d) && (d.protocol === "http:" || d.protocol === "https:")) return d.toString();
  }
  return null;
}

/** Is this a Google redirect we could follow to learn the destination? */
export function isResolvableRedirect(link: string): boolean {
  const u = tryUrl(link);
  return !!u && isGoogleUrl(u) && (u.pathname === "/goto" || u.pathname === "/url");
}

/**
 * Pulls a hostname out of Google's visible display URL. Handles the forms
 * Google uses: "https://www.hardypaw.com › products › x", "www.hardypaw.com/…",
 * "hardypaw.com". Returns null if nothing host-like is found.
 */
export function hostFromDisplayUrl(display: string | null | undefined): string | null {
  if (!display) return null;
  const text = display.replace(/\s+/g, " ").trim();
  const m = text.match(/(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?=$|[\s/›:?#])/i);
  return m ? bareHost(m[1]) : null;
}

/** Best-effort bare host for a result: real link first, display URL as fallback. */
export function itemHost(item: SerpItem): string | null {
  const dest = decodeLink(item.link);
  if (dest) {
    const u = tryUrl(dest);
    if (u) return bareHost(u.hostname);
  }
  return hostFromDisplayUrl(item.displayUrl);
}

/** Does `host` belong to the tracked domain? Exact match only (www ignored), same as before. */
export function hostMatches(host: string | null, domain: string): boolean {
  return !!host && host === bareHost(domain);
}

/**
 * Follows a Google redirect link without opening the destination site:
 * requests the Google link with redirects disabled and reads where it points
 * (Location header, or the link on Google's "Redirect Notice" page).
 * Returns null if Google doesn't answer with a usable destination — callers
 * then keep the display URL instead. Never throws.
 */
export async function resolveGoogleRedirect(link: string, timeoutMs = 8000): Promise<string | null> {
  const start = tryUrl(link);
  if (!start || !isGoogleUrl(start)) return null;
  try {
    const resp = await fetch(start.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const location = resp.headers.get("location");
    if (location) {
      const direct = decodeLink(location);
      if (direct) return direct;
      // Redirected to another Google hop (e.g. /url?q=...) — decode that.
      const next = tryUrl(location, start.toString());
      if (next && isGoogleUrl(next)) return decodeLink(next.toString());
      return null;
    }

    if (resp.ok) {
      // "Redirect Notice" interstitial: the destination is the first
      // non-Google link on the page (or a meta refresh).
      const html = (await resp.text()).slice(0, 200_000);
      const meta = html.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
      const candidates = [meta?.[1], ...Array.from(html.matchAll(/href="([^"]+)"/gi), (m) => m[1])];
      for (const c of candidates) {
        if (!c) continue;
        const decoded = decodeLink(c.replace(/&amp;/g, "&"));
        if (decoded) return decoded;
      }
    }
  } catch {
    // Timeout, block, network error — fall back to the display URL.
  }
  return null;
}

/**
 * Builds a readable URL from a display breadcrumb when the real one can't be
 * resolved, e.g. "https://www.hardypaw.com › products › x" ->
 * "https://www.hardypaw.com/products/x". Google shortens long paths with "…",
 * so this is marked approximate by the caller, not treated as exact.
 */
export function urlFromDisplay(display: string | null | undefined): string | null {
  if (!display) return null;
  const host = display.match(/(?:https?:\/\/)?([^\s/›]+\.[a-z]{2,63})/i)?.[1];
  if (!host) return null;
  const rest = display
    .slice(display.indexOf(host) + host.length)
    .split("›")
    .map((s) => s.trim())
    .filter((s) => s && !s.includes("…") && !s.includes("..."));
  const scheme = /^http:\/\//i.test(display) ? "http" : "https";
  return `${scheme}://${host}${rest.length ? "/" + rest.join("/") : ""}`;
}
