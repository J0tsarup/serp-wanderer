import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { asSnapshot } from "@/lib/serp/snapshot";

// Always rendered per request — reads live database state.
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keyword = await prisma.keyword.findUnique({
    where: { id: params.id },
    include: { domain: true },
  });
  if (!keyword || keyword.domain.userId !== user.id) {
    return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
  }

  await prisma.keyword.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}

// Data for the keyword side panel: position history over a range of days
// (?days=7|30|90, default 30) and the Google results from the latest check.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keyword = await prisma.keyword.findUnique({
    where: { id: params.id },
    include: { domain: { select: { userId: true, name: true } } },
  });
  if (!keyword || keyword.domain.userId !== user.id) {
    return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
  }

  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const checks = await prisma.rankCheck.findMany({
    where: { keywordId: keyword.id, checkedAt: { gte: since } },
    orderBy: { checkedAt: "asc" },
    select: { checkedAt: true, position: true, url: true, error: true },
  });

  return NextResponse.json({
    keyword: {
      id: keyword.id,
      term: keyword.term,
      country: keyword.country,
      device: keyword.device,
      location: keyword.location,
      domain: keyword.domain.name,
    },
    days,
    checks: checks.map((c) => ({ ...c, checkedAt: c.checkedAt.toISOString() })),
    snapshot: asSnapshot(keyword.serpSnapshot),
  });
}
