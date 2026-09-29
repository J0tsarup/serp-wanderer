import { fetchSerp as fetchBrightData } from "../brightdata";
import { fetchSerpScrapingRobot } from "../scrapingrobot";
import type { ResolvedSettings } from "../settings";
import type { SerpItem } from "./resolve";

export type SerpProvider = "brightdata" | "scrapingrobot";
export const SERP_PROVIDERS: SerpProvider[] = ["brightdata", "scrapingrobot"];

export function providerLabel(p: SerpProvider): string {
  return p === "scrapingrobot" ? "Scraping Robot" : "Bright Data";
}

/** Whether the selected provider has the credentials it needs. */
export function providerConfigured(s: ResolvedSettings): boolean {
  return s.serpProvider === "scrapingrobot" ? !!s.scrapingRobotToken : !!s.brightdataApiKey && !!s.brightdataZone;
}

/**
 * Fetch one page (≈10 organic results) of Google results for a keyword with
 * whichever provider the user picked in Settings. Every provider returns the
 * same SerpItem shape, so ranking and link resolution downstream are shared.
 */
export async function fetchSerpPage(
  settings: ResolvedSettings,
  q: {
    keyword: string;
    country: string;
    language: string;
    device: "desktop" | "mobile";
    location: string | null;
    page: number;
  }
): Promise<{ items: SerpItem[] }> {
  if (settings.serpProvider === "scrapingrobot") {
    return fetchSerpScrapingRobot({ token: settings.scrapingRobotToken, render: settings.scrapingRobotRender, ...q });
  }
  return fetchBrightData({ apiKey: settings.brightdataApiKey, zone: settings.brightdataZone, ...q });
}
