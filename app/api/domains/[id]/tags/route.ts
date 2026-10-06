import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Always rendered per request — reads live database state.
export const dynamic = "force-dynamic";

async function assertOwnedDomain(domainId: string, userId: string) {
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  return domain && domain.userId === userId;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await assertOwnedDomain(params.id, user.id))) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const keywords = await prisma.keyword.findMany({
    where: { domainId: params.id },
    select: { tags: true },
  });

  const counts = new Map<string, number>();
  keywords.forEach((k) => k.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));

  const tags = Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  return NextResponse.json({ tags });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await assertOwnedDomain(params.id, user.id))) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const oldTag = (body?.oldTag as string | undefined)?.trim();
  const newTag = (body?.newTag as string | undefined)?.trim();

  if (!oldTag || !newTag) {
    return NextResponse.json({ error: "oldTag and newTag are required" }, { status: 400 });
  }

  const keywords = await prisma.keyword.findMany({
    where: { domainId: params.id, tags: { has: oldTag } },
    select: { id: true, tags: true },
  });

  await prisma.$transaction(
    keywords.map((k) =>
      prisma.keyword.update({
        where: { id: k.id },
        data: { tags: Array.from(new Set(k.tags.map((t) => (t === oldTag ? newTag : t)))) },
      })
    )
  );

  return NextResponse.json({ renamed: keywords.length });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await assertOwnedDomain(params.id, user.id))) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const tag = (body?.tag as string | undefined)?.trim();

  if (!tag) {
    return NextResponse.json({ error: "tag is required" }, { status: 400 });
  }

  const keywords = await prisma.keyword.findMany({
    where: { domainId: params.id, tags: { has: tag } },
    select: { id: true, tags: true },
  });

  await prisma.$transaction(
    keywords.map((k) =>
      prisma.keyword.update({
        where: { id: k.id },
        data: { tags: k.tags.filter((t) => t !== tag) },
      })
    )
  );

  return NextResponse.json({ removedFrom: keywords.length });
}
