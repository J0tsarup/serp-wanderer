import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Always rendered per request — reads live database state.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const domains = await prisma.domain.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { keywords: true } } },
  });
  return NextResponse.json(domains);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

  if (!name) {
    return NextResponse.json({ error: "Domain name is required" }, { status: 400 });
  }

  const existing = await prisma.domain.findFirst({ where: { name, userId: user.id } });
  if (existing) {
    return NextResponse.json({ error: "Domain already tracked" }, { status: 409 });
  }

  const domain = await prisma.domain.create({ data: { name, userId: user.id } });
  return NextResponse.json(domain, { status: 201 });
}
