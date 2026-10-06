import type { Metadata, Viewport } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { APP_VERSION, LAST_UPDATED } from "@/lib/version";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pendingSchemaSql } from "@/lib/schema-check";
import LogoutButton from "@/components/LogoutButton";
import Sidebar from "@/components/Sidebar";
import MobileDomainSwitcher from "@/components/MobileDomainSwitcher";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "SERP Wanderer", template: "%s · SERP Wanderer" },
  description: "Self-hosted Google keyword rank tracker",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0B6E4F" };

const lastUpdatedFormatted = new Date(LAST_UPDATED).toLocaleDateString(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the session first: it touches cookies, which marks this layout as
  // per-request, so nothing below queries the database at build time.
  const user = await getSessionUser();

  // Code deployed before the database update → show what to run instead of
  // a bare "Application error".
  const pendingSql = await pendingSchemaSql();
  if (pendingSql.length > 0) {
    return (
      <html lang="en" className={`${publicSans.variable} ${plexMono.variable}`}>
        <body className="min-h-screen bg-paper font-sans text-ink antialiased">
          <main className="mx-auto max-w-2xl px-6 py-12 space-y-4">
            <h1 className="text-xl font-semibold">Database needs an update</h1>
            <p className="text-sm text-muted">
              This version of SERP Wanderer ({APP_VERSION}) uses database columns that don&apos;t exist yet. Run
              this in Neon&apos;s SQL editor (or <code className="font-mono">npm run db:push</code>), then reload —
              no redeploy needed.
            </p>
            <pre className="rounded-md border border-line bg-surface p-4 text-xs font-mono whitespace-pre-wrap">
              {pendingSql.join("\n")}
            </pre>
          </main>
        </body>
      </html>
    );
  }

  // Fetched once here (not per-page) so the sidebar/switcher persists across
  // navigation without a re-fetch flash — the whole point of a workspace
  // shell instead of separate full pages.
  const domains = user
    ? await prisma.domain.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        include: {
          keywords: {
            select: {
              // A few extra so failed checks can be skipped and still leave
              // the two most recent real results to compare.
              checks: {
                orderBy: { checkedAt: "desc" },
                take: 6,
                select: { position: true, error: true },
              },
            },
          },
        },
      })
    : [];

  const domainSummaries = domains.map((d) => {
    let improved = 0;
    let declined = 0;
    for (const kw of d.keywords) {
      const [latest, prev] = kw.checks.filter((c) => !c.error);
      if (latest?.position != null && prev?.position != null && latest.position !== prev.position) {
        if (latest.position < prev.position) improved++;
        else declined++;
      }
    }
    return { id: d.id, name: d.name, count: d.keywords.length, improved, declined };
  });

  return (
    <html lang="en" className={`${publicSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <header className="border-b border-line">
          <div className="px-4 md:px-6 py-3 flex items-center justify-between">
            <a href="/" className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-semibold tracking-tight text-ink">SERP Wanderer</span>
              <span
                className="text-xs text-muted cursor-default"
                title={`Last updated ${lastUpdatedFormatted}`}
              >
                · {APP_VERSION}
              </span>
            </a>
            {user && (
              <div className="flex items-center gap-4">
                <span className="hidden sm:inline text-sm text-muted">{user.username}</span>
                <a href="/search-console" className="text-sm text-muted hover:text-accent">
                  Search Console
                </a>
                <a href="/settings" className="text-sm text-muted hover:text-accent">
                  Settings
                </a>
                <LogoutButton />
              </div>
            )}
          </div>
        </header>

        {user ? (
          <div className="flex">
            <Sidebar domains={domainSummaries} />
            <div className="flex-1 min-w-0">
              <MobileDomainSwitcher domains={domainSummaries} />
              <main className="px-4 md:px-8 py-6 md:py-10 max-w-4xl mx-auto">{children}</main>
            </div>
          </div>
        ) : (
          <main className="mx-auto max-w-sm px-6 py-10">{children}</main>
        )}
      </body>
    </html>
  );
}
