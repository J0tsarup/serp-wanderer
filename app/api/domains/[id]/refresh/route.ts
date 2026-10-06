import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkStaleKeywords } from "@/lib/rank";
import { getSessionUser } from "@/lib/auth";

// Never statically prerendered — always reads/writes live database state.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Each call does one short batch and reports how many are left; the
// "Refresh now" button keeps calling until nothing remains. Short batches keep
// every request well inside platform limits and let the UI show progress.
const BATCH_BUDGET_MS = 45_000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const domain = await prisma.domain.findUnique({ where: { id: params.id } });
  if (!domain || domain.userId !== user.id) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  // `since` = when the user clicked Refresh. Anything checked after that is
  // already done in this refresh, so repeated calls never re-check a keyword.
  const body = await req.json().catch(() => null);
  const since = Number(body?.since) || Date.now();
  const freshForMs = Math.max(0, Date.now() - since);

  const { outcomes, remaining, halted } = await checkStaleKeywords({
    budgetMs: BATCH_BUDGET_MS,
    freshForMs,
    userId: user.id,
    domainId: domain.id,
  });

  return NextResponse.json({
    halted,
    checked: outcomes.length,
    failed: outcomes.filter((o) => o.error).length,
    remaining,
    outcomes,
  });
}
