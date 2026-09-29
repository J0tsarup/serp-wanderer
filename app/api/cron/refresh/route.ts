import { NextRequest, NextResponse } from "next/server";
import { checkStaleKeywords } from "@/lib/rank";

// Never statically prerendered — always reads/writes live database state.
export const dynamic = "force-dynamic";

// Vercel's current limit with Fluid compute (on by default) is 300s on every
// plan, Hobby included. Each run works in batches inside that budget.
export const maxDuration = 300;

// Stop starting new checks with this much of maxDuration left, so a run
// always finishes cleanly instead of being killed mid-check.
const BUDGET_MS = (maxDuration - 30) * 1000;

// A keyword checked in the last 20h is considered fresh. vercel.json runs
// this several times a day; each run only picks up keywords still due, so
// big lists get spread across runs and nothing is checked (or paid for) twice.
const FRESH_FOR_MS = 20 * 60 * 60 * 1000;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // Vercel automatically sends CRON_SECRET as this exact header on scheduled
  // invocations of routes listed in vercel.json — no extra setup needed.
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;

  // Render (or curl, or any other scheduler) — pass ?secret=... instead,
  // since not every scheduler lets you set a custom header.
  const query = req.nextUrl.searchParams.get("secret");
  if (query === secret) return true;

  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { outcomes, remaining } = await checkStaleKeywords({ budgetMs: BUDGET_MS, freshForMs: FRESH_FOR_MS });
  return NextResponse.json({
    checked: outcomes.length,
    failed: outcomes.filter((o) => o.error).length,
    remaining,
    outcomes,
  });
}
