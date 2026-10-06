import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import InsightsView from "@/components/InsightsView";

export const metadata = { title: "Search Console" };

export const dynamic = "force-dynamic";

export default async function SearchConsolePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const conn = await prisma.googleConnection.findUnique({ where: { userId: user.id } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Search Console</h1>
      </div>

      {!conn?.siteUrl ? (
        <div className="rounded-md border border-line bg-surface px-4 py-3">
          <p className="text-sm text-ink">
            Connect Search Console and choose a property first.
          </p>
          <Link href="/settings" className="text-sm text-accent">
            Go to Settings
          </Link>
        </div>
      ) : (
        <InsightsView siteUrl={conn.siteUrl} />
      )}
    </div>
  );
}
