import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Always rendered per request — reads live database state.
export const dynamic = "force-dynamic";

// Bulk-added keywords are NOT checked immediately (unlike a single add) —
// checking many keywords synchronously risks hitting function timeouts,
// especially with a deep check-depth configured. They'll pick up a position
// on the next "Refresh now" or scheduled cron run.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const domainId = body?.domainId as string | undefined;
  const rawTerms = body?.terms as string | undefined;
  const country = ((body?.country as string | undefined) || "us").toLowerCase();
  const language = ((body?.language as string | undefined) || "en").toLowerCase();
  const device = (body?.device as string | undefined) === "mobile" ? "mobile" : "desktop";
  const location = (body?.location as string | undefined)?.trim() || null;
  const tags = (body?.tags as string[] | undefined)?.map((t) => t.trim()).filter(Boolean) ?? [];

  if (!domainId || !rawTerms?.trim()) {
    return NextResponse.json({ error: "domainId and at least one keyword are required" }, { status: 400 });
  }

  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain || domain.userId !== user.id) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  // Comma or newline separated (paste from Excel/Sheets pastes one per line).
  const rawTermList = rawTerms
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (rawTermList.length === 0) {
    return NextResponse.json({ error: "No valid keywords found" }, { status: 400 });
  }

  // Drop duplicates within the pasted list itself (case-insensitive), keeping
  // the first occurrence.
  const seen = new Set<string>();
  const deduped = rawTermList.filter((term) => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Drop any that already exist for this domain/country/device/location.
  const existing = await prisma.keyword.findMany({
    where: { domainId, country, device, location },
    select: { term: true },
  });
  const existingTerms = new Set(existing.map((k) => k.term.toLowerCase()));
  const toCreate = deduped.filter((term) => !existingTerms.has(term.toLowerCase()));

  const skipped = rawTermList.length - toCreate.length;

  if (toCreate.length === 0) {
    return NextResponse.json({ created: 0, skipped }, { status: 200 });
  }

  const result = await prisma.keyword.createMany({
    data: toCreate.map((term) => ({ domainId, term, country, language, device, location, tags })),
  });

  return NextResponse.json({ created: result.count, skipped }, { status: 201 });
}
