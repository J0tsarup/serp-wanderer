import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getSessionUser } from "@/lib/auth";
import { providerConfigured, providerLabel } from "@/lib/serp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [domains, settings] = await Promise.all([
    prisma.domain.findMany({
      where: { userId: user.id },
      include: {
        keywords: {
          select: {
            term: true,
            // Extra rows so failed checks can be skipped (see filter below).
            checks: { orderBy: { checkedAt: "desc" }, take: 6, select: { position: true, error: true } },
          },
        },
      },
    }),
    getSettings(user.id),
  ]);

  const needsSetup = !providerConfigured(settings);
  const totalKeywords = domains.reduce((sum, d) => sum + d.keywords.length, 0);

  // Biggest single mover across every domain — gives the home page something
  // worth glancing at instead of just being an empty landing spot now that
  // the domain list lives in the sidebar.
  let biggestMover: { domainId: string; domainName: string; term: string; delta: number } | null = null;
  for (const d of domains) {
    for (const kw of d.keywords) {
      const [latest, prev] = kw.checks.filter((c) => !c.error);
      if (latest?.position != null && prev?.position != null) {
        const delta = prev.position - latest.position;
        if (delta !== 0 && (!biggestMover || Math.abs(delta) > Math.abs(biggestMover.delta))) {
          biggestMover = { domainId: d.id, domainName: d.name, term: kw.term, delta };
        }
      }
    }
  }

  return (
    <div className="space-y-8">
      {needsSetup && (
        <div className="rounded-md border border-line bg-surface px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-ink">
            Add your {providerLabel(settings.serpProvider)} credentials before adding keywords — checks won't run without them.
          </p>
          <Link href="/settings" className="text-sm text-accent whitespace-nowrap ml-4">
            Go to Settings
          </Link>
        </div>
      )}

      {domains.length === 0 ? (
        <div>
          <h1 className="text-xl font-semibold text-ink mb-1">Welcome to SERP Wanderer</h1>
          <p className="text-sm text-muted">Add your first domain from the sidebar to start tracking.</p>
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-xl font-semibold text-ink mb-1">Overview</h1>
            <p className="text-sm text-muted">
              {domains.length} domain{domains.length === 1 ? "" : "s"} · {totalKeywords} keyword
              {totalKeywords === 1 ? "" : "s"} tracked
            </p>
          </div>

          {biggestMover && (
            <Link
              href={`/domains/${biggestMover.domainId}`}
              className="block rounded-md border border-line bg-surface px-4 py-3 hover:border-accent"
            >
              <p className="text-xs text-muted mb-1">Biggest mover</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-ink">{biggestMover.term}</p>
                  <p className="text-xs text-muted">{biggestMover.domainName}</p>
                </div>
                <span className={`font-mono text-sm tabular-nums ${biggestMover.delta > 0 ? "text-rise" : "text-fall"}`}>
                  {biggestMover.delta > 0 ? "▲" : "▼"}
                  {Math.abs(biggestMover.delta)}
                </span>
              </div>
            </Link>
          )}

          <p className="text-sm text-muted">Pick a domain from the sidebar to view its keywords.</p>
        </>
      )}
    </div>
  );
}
