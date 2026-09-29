import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getValidAccessToken, listSites, GoogleApiError } from "@/lib/google";

// Never statically prerendered — this route always reads/writes live
// database state, and some deployments run before the schema migration
// that adds newer columns has been applied, which would otherwise break
// the production build.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const domain = await prisma.domain.findUnique({
    where: { id: params.id },
    include: {
      keywords: {
        orderBy: { createdAt: "asc" },
        include: {
          checks: {
            orderBy: { checkedAt: "desc" },
            take: 30,
          },
        },
      },
    },
  });

  if (!domain || domain.userId !== user.id) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }
  return NextResponse.json(domain);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const domain = await prisma.domain.findUnique({ where: { id: params.id } });
  if (!domain || domain.userId !== user.id) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  await prisma.domain.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}

// Set (or clear, with null) the Search Console property used for this domain.
// Validated against the properties the connected Google account can see.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const domain = await prisma.domain.findUnique({ where: { id: params.id } });
  if (!domain || domain.userId !== user.id) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !("gscSiteUrl" in body)) {
    return NextResponse.json({ error: "gscSiteUrl is required (or null to clear)" }, { status: 400 });
  }
  const siteUrl = (body.gscSiteUrl as string | null)?.trim() || null;

  if (siteUrl) {
    try {
      const sites = await listSites(await getValidAccessToken(user.id));
      if (!sites.some((s) => s.siteUrl === siteUrl)) {
        return NextResponse.json({ error: "That property isn't available on the connected Google account" }, { status: 400 });
      }
    } catch (err) {
      const message = err instanceof GoogleApiError ? err.message : "Couldn't reach Google";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  await prisma.domain.update({ where: { id: domain.id }, data: { gscSiteUrl: siteUrl } });
  return NextResponse.json({ ok: true, gscSiteUrl: siteUrl });
}
