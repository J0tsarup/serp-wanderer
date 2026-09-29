"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "./Spinner";

type Candidate = { query: string; clicks: number; impressions: number; ctr: number; position: number };

export default function DiscoverKeywords({
  domainId,
  defaultCountry,
  defaultLanguage,
  defaultLocation,
}: {
  domainId: string;
  defaultCountry: string;
  defaultLanguage: string;
  defaultLocation: string;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingQuery, setAddingQuery] = useState<string | null>(null);
  const [addedQueries, setAddedQueries] = useState<Set<string>>(new Set());
  const router = useRouter();

  useEffect(() => {
    if (!open || candidates) return;
    setLoading(true);
    setError(null);
    fetch(`/api/domains/${domainId}/gsc-discover`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Something went wrong");
        return body;
      })
      .then((body) => setCandidates(body.candidates))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, candidates, domainId]);

  async function addKeyword(query: string) {
    setAddingQuery(query);
    setError(null);
    // Same defaults the "Add keyword" dialog prefills from Settings — without
    // these the API would fall back to US / desktop / no city.
    const res = await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domainId,
        term: query,
        country: defaultCountry,
        language: defaultLanguage,
        location: defaultCountry === "us" ? defaultLocation : "",
        device: "desktop",
      }),
    }).catch(() => null);
    setAddingQuery(null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      setError(`Couldn't add "${query}": ${body?.error ?? "request failed"}`);
      return;
    }
    setAddedQueries((prev) => new Set(prev).add(query));
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-ink hover:text-accent flex items-center gap-1.5"
      >
        {open ? "▾" : "▸"} Keywords you already rank for (from Search Console)
      </button>

      {open && (
        <div className="mt-3">
          {loading && (
            <p className="text-xs text-muted flex items-center gap-1.5">
              <Spinner /> Loading…
            </p>
          )}
          {error && <p className="text-xs text-fall">{error}</p>}
          {candidates && candidates.length === 0 && (
            <p className="text-xs text-muted">
              No untracked queries found with clicks in the last 30 days.
            </p>
          )}
          {candidates && candidates.length > 0 && (
            <div className="min-w-[560px] overflow-x-auto">
              <div className="grid grid-cols-[1fr_80px_90px_90px_60px] gap-3 border-b border-line pb-2 text-xs text-muted">
                <span>Query</span>
                <span>Clicks</span>
                <span>Impressions</span>
                <span>Avg. position</span>
                <span />
              </div>
              <div className="divide-y divide-line">
                {candidates.map((c) => {
                  const added = addedQueries.has(c.query);
                  return (
                    <div key={c.query} className="grid grid-cols-[1fr_80px_90px_90px_60px] gap-3 py-2 text-sm items-center">
                      <span className="text-ink truncate" title={c.query}>
                        {c.query}
                      </span>
                      <span className="font-mono tabular-nums text-ink">{c.clicks}</span>
                      <span className="font-mono tabular-nums text-muted">{c.impressions}</span>
                      <span className="font-mono tabular-nums text-muted">{c.position.toFixed(1)}</span>
                      {added ? (
                        <span className="text-xs text-rise">Added</span>
                      ) : (
                        <button
                          onClick={() => addKeyword(c.query)}
                          disabled={addingQuery === c.query}
                          className="text-xs text-accent hover:underline disabled:opacity-50"
                        >
                          {addingQuery === c.query ? "…" : "+ Track"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
