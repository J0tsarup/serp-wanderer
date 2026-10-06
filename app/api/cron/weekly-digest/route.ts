import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { getValidAccessToken, querySearchAnalytics, GoogleApiError } from "@/lib/google";
import { sendEmail, EmailError } from "@/lib/email";

// Always rendered per request — reads live database state.
export const dynamic = "force-dynamic";
export const maxDuration = 300;


// Search queries and property URLs come from Google, not us — escape them
// before they go into the email's HTML.
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function buildDigestHtml(siteUrl: string, startDate: string, endDate: string, rows: { keys: string[]; clicks: number; impressions: number; position: number }[]) {
  const totalClicks = rows.reduce((sum, r) => sum + r.clicks, 0);
  const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);

  const rowsHtml = rows
    .slice(0, 15)
    .map(
      (r) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #e1e6e1;">${esc(r.keys[0])}</td><td style="padding:6px 10px;border-bottom:1px solid #e1e6e1;text-align:right;">${r.clicks}</td><td style="padding:6px 10px;border-bottom:1px solid #e1e6e1;text-align:right;">${r.impressions}</td><td style="padding:6px 10px;border-bottom:1px solid #e1e6e1;text-align:right;">${r.position.toFixed(1)}</td></tr>`
    )
    .join("");

  return `
    <div style="font-family:sans-serif;color:#16241c;max-width:600px;">
      <h2 style="margin-bottom:4px;">Search Console — last 7 days</h2>
      <p style="color:#5f6f66;margin-top:0;">${esc(siteUrl)} · ${startDate} to ${endDate}</p>
      <p><strong>${totalClicks}</strong> clicks · <strong>${totalImpressions}</strong> impressions</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#5f6f66;">
            <th style="padding:6px 10px;border-bottom:1px solid #e1e6e1;">Query</th>
            <th style="padding:6px 10px;border-bottom:1px solid #e1e6e1;text-align:right;">Clicks</th>
            <th style="padding:6px 10px;border-bottom:1px solid #e1e6e1;text-align:right;">Impressions</th>
            <th style="padding:6px 10px;border-bottom:1px solid #e1e6e1;text-align:right;">Avg. position</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="4" style="padding:10px;color:#5f6f66;">No data for this period.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eligible = await prisma.settings.findMany({
    where: { digestEnabled: true, digestEmail: { not: null }, resendApiKey: { not: null } },
    select: { userId: true, digestEmail: true, resendApiKey: true },
  });

  const results: { userId: string | null; status: string }[] = [];

  for (const s of eligible) {
    if (!s.userId || !s.digestEmail || !s.resendApiKey) continue;

    const conn = await prisma.googleConnection.findUnique({ where: { userId: s.userId } });
    if (!conn?.siteUrl) {
      results.push({ userId: s.userId, status: "skipped: no Search Console property" });
      continue;
    }

    try {
      const accessToken = await getValidAccessToken(s.userId);

      const end = new Date();
      end.setDate(end.getDate() - 2);
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      const startDate = start.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);

      const rows = await querySearchAnalytics({
        accessToken,
        siteUrl: conn.siteUrl,
        startDate,
        endDate,
        dimensions: ["query"],
        type: "web",
        rowLimit: 15,
      });

      const html = buildDigestHtml(conn.siteUrl, startDate, endDate, rows);
      await sendEmail({
        apiKey: s.resendApiKey,
        to: s.digestEmail,
        subject: `Search Console: last 7 days for ${conn.siteUrl}`,
        html,
      });
      results.push({ userId: s.userId, status: "sent" });
    } catch (err) {
      const message = err instanceof GoogleApiError || err instanceof EmailError ? err.message : "Unknown error";
      results.push({ userId: s.userId, status: `failed: ${message}` });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
