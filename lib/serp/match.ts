import { SerpItem, itemHost, hostMatches } from "./resolve";

/**
 * Given one page of normalized results and a target domain, find the
 * best-ranking match. Returns null if the domain doesn't appear.
 *
 * Positions come from the provider's organic `rank` when it gives one, else
 * from the result's order. `pageOffset` is how many organic results came
 * before this page: if this page's ranks restart near 1 they're page-relative
 * and the offset is added; if they already continue past the offset they're
 * used as-is — so page 2+ numbers correctly (11, 12, ...) either way.
 *
 * Matching uses itemHost(), which reads the real link when there is one and
 * Google's display URL when the link is an opaque redirect (/goto?url=...).
 */
export function findRanking(
  items: SerpItem[],
  targetDomain: string,
  pageOffset = 0
): { position: number; item: SerpItem } | null {
  if (items.length === 0) return null;

  const ranks = items.map((r, i) => (typeof r.rank === "number" && r.rank > 0 ? r.rank : i + 1));
  const isPageRelative = pageOffset > 0 && Math.min(...ranks) <= pageOffset;

  const ranked = items
    .map((item, i) => ({ item, position: isPageRelative ? pageOffset + ranks[i] : ranks[i] }))
    .sort((a, b) => a.position - b.position);

  return ranked.find((r) => hostMatches(itemHost(r.item), targetDomain)) ?? null;
}
