"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "./Spinner";

// Refreshes a domain in batches: each request checks what fits in a short
// window and says how many are left, and this keeps going until none are.
export default function RefreshButton({ domainId }: { domainId: string }) {
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function refresh() {
    setLoading(true);
    setMessage(null);
    setRemaining(null);
    const since = Date.now();
    let checked = 0;
    let failed = 0;

    for (let round = 0; round < 50; round++) {
      const res = await fetch(`/api/domains/${domainId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since }),
      }).catch(() => null);
      const body = await res?.json().catch(() => null);

      if (!res?.ok || !body) {
        setMessage(body?.error ?? "Refresh stopped — the server didn't respond. Try again.");
        break;
      }
      checked += body.checked ?? 0;
      failed += body.failed ?? 0;
      setRemaining(body.remaining ?? 0);
      router.refresh(); // show results as each batch lands

      if (!body.remaining || body.checked === 0) break;
    }

    setLoading(false);
    setRemaining(null);
    setMessage((m) => m ?? (failed > 0 ? `Checked ${checked} — ${failed} failed (see rows).` : checked ? `Checked ${checked}.` : null));
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {message && !loading && <span className="hidden sm:inline text-xs text-muted">{message}</span>}
      <button
        onClick={refresh}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-md border border-line bg-surface text-sm px-3 py-1.5 text-ink hover:border-accent hover:text-accent transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {loading && <Spinner />}
        {loading ? (remaining != null ? `Checking… ${remaining} left` : "Checking…") : "Refresh now"}
      </button>
    </div>
  );
}
