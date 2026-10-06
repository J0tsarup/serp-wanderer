import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkKeyword } from "@/lib/rank";
import { getSessionUser } from "@/lib/auth";

// Always rendered per request — reads live database state.
export const dynamic = "force-dynamic";

// A deep check (checking further than the top 10) pages through multiple
// Bright Data requests, which can take longer than the default timeout.
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keyword = await prisma.keyword.findUnique({
    where: { id: params.id },
    include: { domain: true },
  });
  if (!keyword || keyword.domain.userId !== user.id) {
    return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
  }

  const outcome = await checkKeyword(params.id);
  return NextResponse.json(outcome);
}
