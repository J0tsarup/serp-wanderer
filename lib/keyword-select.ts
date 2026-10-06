import type { Prisma } from "@prisma/client";

// Fields the keyword table needs, plus the last 30 checks for sparklines and
// deltas. serpSnapshot is deliberately left out — it can be tens of KB per
// keyword and is loaded one keyword at a time by the side panel.
export const keywordListSelect = {
  id: true,
  term: true,
  country: true,
  language: true,
  device: true,
  location: true,
  tags: true,
  createdAt: true,
  checks: { orderBy: { checkedAt: "desc" }, take: 30 },
} satisfies Prisma.KeywordSelect;
