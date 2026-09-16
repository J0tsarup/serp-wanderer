import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkKeyword } from "@/lib/rank";
import { getSessionUser } from "@/lib/auth";

// Never statically prerendered — this route always reads/writes live
// database state, and some deployments run before the schema migration
// that adds newer columns has been applied, which would otherwise break
// the production build.
export const dynamic = "force-dynamic";

// A deep check (checking further than the top 10) pages through multiple
// Bright Data requests, which can take longer than the default timeout.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const domainId = body?.domainId as string | undefined;
  const term = (body?.term as string | undefined)?.trim();
  const country = ((body?.country as string | undefined) || "us").toLowerCase();
  const language = ((body?.language as string | undefined) || "en").toLowerCase();
  const device = (body?.device as string | undefined) === "mobile" ? "mobile" : "desktop";
  const location = (body?.location as string | undefined)?.trim() || null;
  const tags = (body?.tags as string[] | undefined)?.map((t) => t.trim()).filter(Boolean) ?? [];

  if (!domainId || !term) {
    return NextResponse.json({ error: "domainId and term are required" }, { status: 400 });
  }

  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain || domain.userId !== user.id) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const existing = await prisma.keyword.findFirst({
    where: { domainId, country, device, location, term: { equals: term, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json({ duplicate: true, keyword: existing }, { status: 200 });
  }

  const keyword = await prisma.keyword.create({
    data: { domainId, term, country, language, device, location, tags },
  });

  // Check it immediately so the UI doesn't show an empty row until the next cron run.
  const outcome = await checkKeyword(keyword.id);

  return NextResponse.json({ keyword, outcome }, { status: 201 });
}
