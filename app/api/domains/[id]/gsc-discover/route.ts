import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { tryGetQueryMetricsForDomain } from "@/lib/google";

// Never statically prerendered — always reads live database + calls Google.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const domain = await prisma.domain.findUnique({ where: { id: params.id } });
  if (!domain || domain.userId !== user.id) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const metrics = await tryGetQueryMetricsForDomain(user.id, domain);
  if (!metrics) {
    return NextResponse.json(
      { error: "Search Console isn't connected, or no property is set for this domain" },
      { status: 400 }
    );
  }

  const tracked = await prisma.keyword.findMany({ where: { domainId: params.id }, select: { term: true } });
  const trackedSet = new Set(tracked.map((k) => k.term.toLowerCase()));

  const candidates = Array.from(metrics.entries())
    .filter(([query]) => !trackedSet.has(query))
    .map(([query, m]) => ({ query, ...m }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 50);

  return NextResponse.json({ candidates });
}
