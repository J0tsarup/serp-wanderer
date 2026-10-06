import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { keywordListSelect } from "@/lib/keyword-select";
import { getSettings } from "@/lib/settings";
import { getSessionUser } from "@/lib/auth";
import { tryGetQueryMetricsForDomain, propertyForDomain } from "@/lib/google";
import DomainGscProperty from "@/components/DomainGscProperty";
import AddKeywordTrigger from "@/components/AddKeywordTrigger";
import KeywordTable from "@/components/KeywordTable";
import RefreshButton from "@/components/RefreshButton";
import { SelectionProvider } from "@/components/SelectionContext";
import DiscoverKeywords from "@/components/DiscoverKeywords";

export const dynamic = "force-dynamic";

export default async function DomainPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [domain, settings] = await Promise.all([
    prisma.domain.findUnique({
      where: { id: params.id },
      include: {
        keywords: {
          orderBy: { createdAt: "asc" },
          select: keywordListSelect,
        },
      },
    }),
    getSettings(user.id),
  ]);

  if (!domain || domain.userId !== user.id) notFound();

  // Search Console data comes from this domain's own property (or the
  // account's, if it covers this domain) — never another site's.
  const [gscMetricsMap, googleConn] = await Promise.all([
    tryGetQueryMetricsForDomain(user.id, domain),
    prisma.googleConnection.findUnique({ where: { userId: user.id }, select: { accessToken: true, siteUrl: true } }),
  ]);
  const gscProperty = propertyForDomain(domain, googleConn?.siteUrl);

  const keywords = domain.keywords.map((k) => ({
    id: k.id,
    term: k.term,
    country: k.country,
    device: k.device,
    location: k.location,
    tags: k.tags,
    checks: k.checks.map((c) => ({
      checkedAt: c.checkedAt.toISOString(),
      position: c.position,
      url: c.url,
      error: c.error,
    })),
  }));

  // Server Components can't pass a Map across to Client Components — flatten
  // to a plain object.
  const gscMetrics = gscMetricsMap ? Object.fromEntries(gscMetricsMap) : null;

  return (
    <SelectionProvider>
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink truncate">{domain.name}</h1>
          {googleConn?.accessToken && (
            <DomainGscProperty
              domainId={domain.id}
              current={gscProperty}
              isOwnSetting={!!domain.gscSiteUrl}
            />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <RefreshButton domainId={domain.id} />
          <AddKeywordTrigger
            domainId={domain.id}
            defaultCountry={settings.defaultCountry}
            defaultLanguage={settings.defaultLanguage}
            defaultLocation={settings.defaultLocation ?? ""}
          />
        </div>
      </div>

      <section className="overflow-x-auto">
        <KeywordTable
          keywords={keywords}
          maxCheckDepth={settings.maxCheckDepth}
          domainId={domain.id}
          gscMetrics={gscMetrics}
        />
      </section>

      {gscMetrics && (
        <section className="border-t border-line pt-6">
          <DiscoverKeywords
            domainId={domain.id}
            defaultCountry={settings.defaultCountry}
            defaultLanguage={settings.defaultLanguage}
            defaultLocation={settings.defaultLocation ?? ""}
          />
        </section>
            )}
    </div>
    </SelectionProvider>
  );
}
