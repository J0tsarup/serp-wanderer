"use client";

import { useEffect, useState } from "react";
import PositionChart from "./PositionChart";
import { Spinner } from "./Spinner";
import RelativeTime from "./RelativeTime";
import type { SerpSnapshot } from "@/lib/serp/snapshot";

type Detail = {
  keyword: { id: string; term: string; country: string; device: string; location: string | null; domain: string };
  days: number;
  checks: { checkedAt: string; position: number | null; url: string | null; error: string | null }[];
  snapshot: SerpSnapshot | null;
};

const RANGES = [7, 30, 90] as const;

// Side panel for one keyword: position history over a chosen range, and the
// Google results captured in its latest successful check.
export default function KeywordDrawer({
  keywordId,
  maxCheckDepth,
  onClose,
}: {
  keywordId: string;
  maxCheckDepth: number;
  onClose: () => void;
}) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/keywords/${keywordId}?days=${days}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? "Couldn't load this keyword");
        return body as Detail;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [keywordId, days]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const completed = (data?.checks ?? []).filter((c) => !c.error);
  const latest = data?.checks[data.checks.length - 1];
  const latestGood = completed[completed.length - 1];
  const ranked = completed.filter((c) => c.position != null).map((c) => c.position as number);
  const best = ranked.length ? Math.min(...ranked) : null;
  const first = completed[0]?.position ?? null;
  const change = first != null && latestGood?.position != null ? first - latestGood.position : null;
  const snap = data?.snapshot ?? null;
  const city = data?.keyword.location?.split(",")[0];

  let badge: { text: string; tone: string } | null = null;
  if (latest?.error) badge = { text: "Last check failed", tone: "text-fall bg-fall/10" };
  else if (latestGood?.position != null) badge = { text: `#${latestGood.position}`, tone: "text-rise bg-rise/10" };
  else if (latestGood) badge = { text: `Not in top ${snap?.scanned ?? maxCheckDepth}`, tone: "text-muted bg-line/60" };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Keyword details">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <aside className="relative h-full w-full max-w-xl bg-paper border-l border-line shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-paper border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-ink break-words">{data?.keyword.term ?? "…"}</h2>
              {badge && <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badge.tone}`}>{badge.text}</span>}
            </div>
            {data && (
              <p className="text-xs text-muted mt-0.5">
                {data.keyword.domain} · {data.keyword.country.toUpperCase()}
                {city ? ` · ${city}` : ""} · {data.keyword.device}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none px-1" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="px-5 py-5 space-y-8">
          {error && <p className="text-sm text-fall">{error}</p>}

          {/* Position history */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Position history</h3>
              <div className="flex rounded-md border border-line overflow-hidden text-xs">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setDays(r)}
                    className={`px-2.5 py-1 ${days === r ? "bg-ink text-white" : "bg-surface text-muted hover:text-ink"}`}
                  >
                    {r}d
                  </button>
                ))}
              </div>
            </div>

            {loading && !data ? (
              <p className="text-xs text-muted flex items-center gap-1.5">
                <Spinner /> Loading…
              </p>
            ) : (
              <>
                <PositionChart
                  // PositionChart expects newest first; failed checks are left out.
                  checks={completed.slice().reverse()}
                  maxCheckDepth={snap?.depth ?? maxCheckDepth}
                />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="Latest" value={latestGood?.position != null ? `#${latestGood.position}` : latestGood ? "—" : "No data"} />
                  <Stat label={`Best (${days}d)`} value={best != null ? `#${best}` : "—"} />
                  <Stat
                    label={`Change (${days}d)`}
                    value={change == null || change === 0 ? "—" : change > 0 ? `▲${change}` : `▼${Math.abs(change)}`}
                    tone={change && change > 0 ? "text-rise" : change && change < 0 ? "text-fall" : undefined}
                  />
                </div>
                {data && data.checks.length > completed.length && (
                  <p className="text-xs text-muted">
                    {data.checks.length - completed.length} failed check
                    {data.checks.length - completed.length === 1 ? "" : "s"} in this range not shown on the chart.
                  </p>
                )}
              </>
            )}
          </section>

          {/* Google results from the latest check */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Google results</h3>
              {snap && (
                <span className="text-xs text-muted">
                  <RelativeTime iso={snap.checkedAt} className="cursor-default" /> · {snap.provider}
                </span>
              )}
            </div>

            {!snap ? (
              <p className="text-xs text-muted">
                {loading ? "Loading…" : "No results saved yet — they're captured from the next successful check onward."}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted rounded-md border border-line bg-surface px-3 py-2">
                  {snap.found
                    ? `${snap.scanned} results scanned — stopped at your ranking, so later positions weren't fetched.`
                    : snap.scanned < snap.depth
                    ? `${snap.scanned} results scanned — Google returned fewer than the ${snap.depth} checked for; ${data?.keyword.domain} wasn't among them.`
                    : `Top ${snap.scanned} scanned (your check depth) — ${data?.keyword.domain} wasn't among them.`}
                </p>
                <ol className="divide-y divide-line">
                  {snap.items.map((it) => (
                    <li
                      key={`${it.position}-${it.link}`}
                      className={`py-2.5 flex gap-3 ${it.isTarget ? "bg-accent/10 -mx-2 px-2 rounded" : ""}`}
                    >
                      <span className="w-7 shrink-0 text-right font-mono text-xs tabular-nums text-muted pt-0.5">
                        {it.position}
                      </span>
                      <div className="min-w-0">
                        <a
                          href={it.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-accent hover:underline break-words"
                        >
                          {it.title || it.host || "Untitled result"}
                        </a>
                        <p className="text-xs text-muted truncate" title={it.url ?? it.display ?? undefined}>
                          {it.url ?? it.display ?? it.host ?? "—"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-2 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`text-sm font-mono tabular-nums ${tone ?? "text-ink"}`}>{value}</p>
    </div>
  );
}
