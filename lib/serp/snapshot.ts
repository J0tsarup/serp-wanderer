// The Google results captured during a keyword's most recent successful
// check — shown in the keyword side panel. Stored as JSON on Keyword
// (latest only, so storage stays small).

export type SerpSnapshotItem = {
  position: number;
  title: string;
  host: string | null; // site the result belongs to, e.g. "chewy.com"
  url: string | null; // real destination when known
  link: string; // what to open: the real URL, or Google's redirect link (works in a browser)
  display: string | null; // address as Google printed it
  isTarget: boolean; // this is the tracked domain
};

export type SerpSnapshot = {
  checkedAt: string;
  provider: string;
  items: SerpSnapshotItem[];
  scanned: number; // organic results looked at
  depth: number; // configured check depth at the time
  found: boolean; // stopped early because the tracked domain was found
};

/** Rough guard so a malformed row can't break the UI. */
export function asSnapshot(value: unknown): SerpSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SerpSnapshot>;
  return Array.isArray(v.items) && typeof v.checkedAt === "string" ? (v as SerpSnapshot) : null;
}
