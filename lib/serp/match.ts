import { SerpItem, itemHost, hostMatches } from "./resolve";

/**
 * Assigns organic positions to one page of results.
 *
 * Positions come from the provider's organic `rank` when it gives one, else
 * from the result's order. `pageOffset` is how many organic results came
 * before this page: if this page's ranks restart near 1 they're page-relative
 * and the offset is added; if they already continue past the offset they're
 * used as-is — so page 2+ numbers correctly (11, 12, ...) either way.
 */
export function rankItems(items: SerpItem[], pageOffset = 0): { item: SerpItem; position: number }[] {
  if (items.length === 0) return [];
  const ranks = items.map((r, i) => (typeof r.rank === "number" && r.rank > 0 ? r.rank : i + 1));
  const isPageRelative = pageOffset > 0 && Math.min(...ranks) <= pageOffset;
  return items
    .map((item, i) => ({ item, position: isPageRelative ? pageOffset + ranks[i] : ranks[i] }))
    .sort((a, b) => a.position - b.position);
}

/**
 * Best-ranking result on this page that belongs to the target domain, or
 * null. Matching uses itemHost(), which reads the real link when there is
 * one and Google's display URL when the link is an opaque redirect
 * (/goto?url=...).
 */
export function findRanking(
  items: SerpItem[],
  targetDomain: string,
  pageOffset = 0
): { position: number; item: SerpItem } | null {
  return rankItems(items, pageOffset).find((r) => hostMatches(itemHost(r.item), targetDomain)) ?? null;
}
