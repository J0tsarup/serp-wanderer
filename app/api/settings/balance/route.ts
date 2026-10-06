import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { getSessionUser } from "@/lib/auth";

// Bright Data's /customer/balance endpoint reports paid account balance (USD),
// not the separate free-tier monthly credit allowance — there's no
// documented public API for that figure, so this can't show "X/5,000 free
// credits used." It's still useful once you're spending beyond the free tier.
//
// Always rendered per request — reads live database state.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { brightdataApiKey } = await getSettings(user.id);
  if (!brightdataApiKey) {
    return NextResponse.json({ error: "No API key configured yet" }, { status: 400 });
  }

  try {
    const resp = await fetch("https://api.brightdata.com/customer/balance", {
      headers: { Authorization: `Bearer ${brightdataApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return NextResponse.json({ error: `Bright Data returned ${resp.status}` }, { status: 502 });
    }
    const data = await resp.json();
    return NextResponse.json({ balance: data.balance, pendingBalance: data.pending_balance });
  } catch {
    return NextResponse.json({ error: "Couldn't reach Bright Data" }, { status: 502 });
  }
}
