import { prisma } from "./db";

// Search Console API — verified against Google's own docs (developers.google.com/webmaster-tools).
// OAuth scope for read access:
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/webmasters/v3";

export class GoogleApiError extends Error {}

function getRedirectUri(req: Request): string {
  // Derived from the incoming request rather than hardcoded, so this works
  // the same on localhost, preview deploys, and production without config.
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/api/google/callback`;
}

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // required to receive a refresh_token
    prompt: "consent", // ensures a refresh_token is returned even on a repeat connection
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export { getRedirectUri };

export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new GoogleApiError(`Token exchange failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  return resp.json();
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in: number }> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new GoogleApiError(`Token refresh failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  return resp.json();
}

/**
 * Returns a valid access token for this user's Google connection, refreshing
 * it first if it's expired (or close to it). Throws GoogleApiError if not
 * connected or refresh fails.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const conn = await prisma.googleConnection.findUnique({ where: { userId } });
  if (!conn?.accessToken || !conn.refreshToken || !conn.clientId || !conn.clientSecret) {
    throw new GoogleApiError("Search Console isn't connected yet.");
  }

  const expiringSoon = !conn.tokenExpiry || conn.tokenExpiry.getTime() < Date.now() + 60_000;
  if (!expiringSoon) return conn.accessToken;

  const refreshed = await refreshAccessToken(conn.refreshToken, conn.clientId, conn.clientSecret);
  const tokenExpiry = new Date(Date.now() + refreshed.expires_in * 1000);

  await prisma.googleConnection.update({
    where: { userId },
    data: { accessToken: refreshed.access_token, tokenExpiry },
  });

  return refreshed.access_token;
}

export type SearchConsoleSite = { siteUrl: string; permissionLevel: string };

export async function listSites(accessToken: string): Promise<SearchConsoleSite[]> {
  const resp = await fetch(`${API_BASE}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new GoogleApiError(`Couldn't list Search Console properties (${resp.status})`);
  const data = await resp.json();
  return data.siteEntry ?? [];
}

export type QueryMetric = { clicks: number; impressions: number; ctr: number; position: number };

/**
 * Fetches recent query-level performance for a property, keyed by lowercased
 * query text — used both to annotate tracked keywords with real click/
 * impression data, and to surface already-ranking queries that aren't
 * tracked yet.
 */
export async function getQueryMetrics(
  accessToken: string,
  siteUrl: string,
  days = 30
): Promise<Map<string, QueryMetric>> {
  const end = new Date();
  end.setDate(end.getDate() - 2); // Search Console data typically lags 1-2 days
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const rows = await querySearchAnalytics({
    accessToken,
    siteUrl,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    dimensions: ["query"],
    type: "web",
    rowLimit: 5000,
  });

  const map = new Map<string, QueryMetric>();
  for (const row of rows) {
    map.set(row.keys[0].toLowerCase(), {
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    });
  }
  return map;
}

export type SearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function bareDomain(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  return h.startsWith("www.") ? h.slice(4) : h;
}

/**
 * Whether a Search Console property covers a tracked domain.
 * - Domain properties ("sc-domain:hardypaw.com") cover the domain and all its
 *   subdomains.
 * - URL-prefix properties ("https://www.hardypaw.com/") match on hostname,
 *   ignoring a leading "www.".
 */
export function siteMatchesDomain(siteUrl: string, domainName: string): boolean {
  const domain = bareDomain(domainName);
  if (siteUrl.startsWith("sc-domain:")) {
    const prop = bareDomain(siteUrl.slice("sc-domain:".length));
    return domain === prop || domain.endsWith(`.${prop}`);
  }
  try {
    return bareDomain(new URL(siteUrl).hostname) === domain;
  } catch {
    return false;
  }
}

// Query metrics are fetched per property and reused for an hour within a
// warm server instance, so opening domain pages doesn't pull thousands of
// Search Console rows on every load.
const METRICS_TTL_MS = 60 * 60 * 1000;
const metricsCache = new Map<string, { at: number; data: Map<string, QueryMetric> }>();

/** The Search Console property to use for a domain: its own, else the account's if it covers the domain. */
export function propertyForDomain(
  domain: { name: string; gscSiteUrl: string | null },
  accountSiteUrl: string | null | undefined
): string | null {
  if (domain.gscSiteUrl) return domain.gscSiteUrl;
  if (accountSiteUrl && siteMatchesDomain(accountSiteUrl, domain.name)) return accountSiteUrl;
  return null;
}

/**
 * Resolves a valid access token and the right property for this domain,
 * then returns the query metrics map. Returns null (rather than throwing)
 * if Search Console isn't connected or no property applies to this domain —
 * callers treat that as "no GSC data available," not an error.
 */
export async function tryGetQueryMetricsForDomain(
  userId: string,
  domain: { name: string; gscSiteUrl: string | null }
): Promise<Map<string, QueryMetric> | null> {
  const conn = await prisma.googleConnection.findUnique({ where: { userId } });
  if (!conn?.accessToken) return null;
  const siteUrl = propertyForDomain(domain, conn.siteUrl);
  if (!siteUrl) return null;

  const key = `${userId}|${siteUrl}`;
  const cached = metricsCache.get(key);
  if (cached && Date.now() - cached.at < METRICS_TTL_MS) return cached.data;

  try {
    const accessToken = await getValidAccessToken(userId);
    const data = await getQueryMetrics(accessToken, siteUrl);
    metricsCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/**
 * Queries Search Analytics for a property. `type` is Google's search-surface
 * filter: "web" (default), "discover", "news", "googleNews", "image", "video".
 * Note: Discover and News data doesn't support the "query" dimension — only
 * page/date/country/device — Google's API returns an error if you ask for it.
 */
export async function querySearchAnalytics(params: {
  accessToken: string;
  siteUrl: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  dimensions: string[];
  type?: "web" | "discover" | "news" | "googleNews" | "image" | "video";
  rowLimit?: number;
}): Promise<SearchAnalyticsRow[]> {
  const resp = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions,
        type: params.type ?? "web",
        rowLimit: params.rowLimit ?? 25,
      }),
    }
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new GoogleApiError(`Search Analytics query failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data.rows ?? [];
}
