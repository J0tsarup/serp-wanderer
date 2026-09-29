"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Site = { siteUrl: string; permissionLevel: string };

// Small line under the domain name: which Search Console property feeds this
// domain's clicks/impressions, with a picker to change it.
export default function DomainGscProperty({
  domainId,
  current,
  isOwnSetting,
}: {
  domainId: string;
  current: string | null;
  isOwnSetting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function open() {
    setEditing(true);
    setError(null);
    if (sites) return;
    const res = await fetch("/api/google/sites").catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) {
      setError(body?.error ?? "Couldn't load Search Console properties");
      return;
    }
    setSites(body.sites ?? []);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/domains/${domainId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gscSiteUrl: value || null }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(body?.error ?? "Couldn't save");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <p className="text-xs text-muted mt-0.5 truncate">
        Search Console: {current ? current : "no property for this domain"}
        {current && !isOwnSetting && " (account default)"}{" "}
        <button onClick={open} className="text-accent hover:underline">
          change
        </button>
      </p>
    );
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!sites || busy}
        className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink max-w-[260px]"
      >
        <option value="">None / account default if it matches</option>
        {sites?.map((s) => (
          <option key={s.siteUrl} value={s.siteUrl}>
            {s.siteUrl}
          </option>
        ))}
      </select>
      <button onClick={save} disabled={!sites || busy} className="text-accent hover:underline disabled:opacity-50">
        {busy ? "Saving…" : "Save"}
      </button>
      <button onClick={() => setEditing(false)} className="text-muted hover:text-ink">
        Cancel
      </button>
      {!sites && !error && <span className="text-muted">Loading…</span>}
      {error && <span className="text-fall">{error}</span>}
    </div>
  );
}
