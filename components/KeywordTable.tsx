"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckPoint } from "./PositionChart";
import { Sparkline } from "./Sparkline";
import { Spinner } from "./Spinner";
import TagManager from "./TagManager";
import RelativeTime from "./RelativeTime";
import MoveDomainModal from "./MoveDomainModal";
import KeywordDrawer from "./KeywordDrawer";
import { useSelection } from "./SelectionContext";

export type KeywordRow = {
  id: string;
  term: string;
  country: string;
  device: string;
  location: string | null;
  tags: string[];
  checks: CheckPoint[];
};

export type GscMetric = { clicks: number; impressions: number; ctr: number; position: number };

function formatCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// Failed checks (Bright Data error, timeout) are stored with an `error` so
// they don't read as "not ranking". Positions, deltas, trends and sorting use
// only checks that actually completed; "Last checked" uses the newest attempt.
function completedChecks(checks: CheckPoint[]): CheckPoint[] {
  return checks.filter((c) => !c.error);
}

function cityLabel(location: string | null): string | null {
  if (!location) return null;
  return location.split(",")[0] || location;
}

function PositionCell({
  current,
  previous,
  maxCheckDepth,
  failedError,
  hasCompleted,
}: {
  current: number | null;
  previous: number | null;
  maxCheckDepth: number;
  failedError?: string | null; // set when the most recent attempt failed
  hasCompleted?: boolean; // whether any check has ever completed
}) {
  if (failedError) {
    const lastKnown = !hasCompleted ? null : current == null ? `outside top ${maxCheckDepth}` : `#${current}`;
    return (
      <div className="text-sm" title={failedError}>
        <span className="text-fall">Check failed</span>
        {lastKnown && <div className="text-xs text-muted">last: {lastKnown}</div>}
      </div>
    );
  }
  if (!hasCompleted) {
    return <span className="text-sm text-muted">—</span>;
  }
  if (current == null) {
    return <span className="text-sm text-muted">Outside top {maxCheckDepth}</span>;
  }
  const delta = previous != null ? previous - current : null; // positive = improved

  return (
    <div className="flex items-baseline gap-2 font-mono">
      <span className="text-[15px] font-medium tabular-nums text-ink">{current}</span>
      {delta != null && delta !== 0 && (
        <span className={`text-xs tabular-nums ${delta > 0 ? "text-rise" : "text-fall"}`}>
          {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
        </span>
      )}
    </div>
  );
}

function RankingUrlCell({ url }: { url: string | null | undefined }) {
  if (!url) return <span className="text-xs text-muted">—</span>;
  let path = "";
  try {
    path = new URL(url).pathname.replace(/\/$/, "") || "/";
  } catch {
    path = url;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block text-xs text-muted hover:text-accent truncate max-w-[130px]"
      title={url}
    >
      {path}
    </a>
  );
}

function GscCell({ gsc }: { gsc?: GscMetric }) {
  if (!gsc) return <span className="text-xs text-muted">—</span>;
  return (
    <div
      className="text-xs text-muted"
      title={`${gsc.clicks} clicks, ${gsc.impressions} impressions, ${(gsc.ctr * 100).toFixed(1)}% CTR, avg. position ${gsc.position.toFixed(1)} — last 30 days from Search Console`}
    >
      {formatCompact(gsc.clicks)} clicks
      <br />
      {formatCompact(gsc.impressions)} impr
    </div>
  );
}

type SortColumn = "position" | "lastChecked" | null;
type SortDirection = "asc" | "desc" | null;

function SortHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-left hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
    >
      {label}
      {active && direction && <span className="text-[10px]">{direction === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

function toCsv(rows: KeywordRow[]): string {
  const header = ["Keyword", "Tags", "Country", "City", "Device", "Position", "Ranking URL", "Last checked", "Last check error"];
  const lines = rows.map((kw) => {
    const [latest] = kw.checks;
    const [lastGood] = completedChecks(kw.checks);
    return [
      kw.term,
      kw.tags.join("; "),
      kw.country.toUpperCase(),
      cityLabel(kw.location) ?? "",
      kw.device,
      lastGood?.position ?? "",
      lastGood?.url ?? "",
      latest ? new Date(latest.checkedAt).toISOString() : "",
      latest?.error ?? "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

// One row per recorded check, not just the latest — useful for charting
// trends elsewhere. Limited to whatever history is loaded (the last 30
// checks per keyword), same as the in-app trend chart.
function toFullHistoryCsv(rows: KeywordRow[]): string {
  const header = ["Keyword", "Tags", "Country", "City", "Device", "Date", "Position", "Ranking URL", "Error"];
  const lines: string[] = [];
  rows.forEach((kw) => {
    kw.checks.forEach((c) => {
      lines.push(
        [
          kw.term,
          kw.tags.join("; "),
          kw.country.toUpperCase(),
          cityLabel(kw.location) ?? "",
          kw.device,
          new Date(c.checkedAt).toISOString(),
          c.position ?? "",
          c.url ?? "",
          c.error ?? "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
    });
  });
  return [header.join(","), ...lines].join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function desktopGridCols(hasGsc: boolean) {
  // checkbox | keyword | position | [GSC] | trend | url | last checked | check | remove
  return `hidden md:grid ${
    hasGsc
      ? "md:grid-cols-[20px_1fr_70px_100px_84px_120px_96px_50px_60px]"
      : "md:grid-cols-[20px_1fr_70px_84px_120px_96px_50px_60px]"
  } items-center gap-4`;
}

export default function KeywordTable({
  keywords,
  maxCheckDepth,
  domainId,
  gscMetrics,
}: {
  keywords: KeywordRow[];
  maxCheckDepth: number;
  domainId: string;
  gscMetrics?: Record<string, GscMetric> | null;
}) {
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [justUpdatedIds, setJustUpdatedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Selection lives in context so the page's Refresh button can act on it.
  const { selected, setSelected, checkSelectedRef } = useSelection();
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const router = useRouter();

  // Let the header's "Refresh selected" button run the same check as
  // Actions → Check (so rows get spinners, errors and the stop-early rule).
  useEffect(() => {
    checkSelectedRef.current = () => bulkAction("check");
    return () => {
      checkSelectedRef.current = null;
    };
  });

  const allTags = useMemo(() => {
    const set = new Set<string>();
    keywords.forEach((k) => k.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [keywords]);

  const filtered = useMemo(
    () => (tagFilter === "all" ? keywords : keywords.filter((k) => k.tags.includes(tagFilter))),
    [keywords, tagFilter]
  );

  const visible = useMemo(() => {
    if (!sortColumn || !sortDirection) return filtered;
    const withValue = filtered.map((kw) => {
      const [latest] = kw.checks;
      const [lastGood] = completedChecks(kw.checks);
      const value =
        sortColumn === "position"
          ? lastGood?.position ?? null
          : latest
          ? new Date(latest.checkedAt).getTime()
          : null;
      return { kw, value };
    });
    // Rows with no value (never checked) always sort to the end, regardless of direction.
    withValue.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return sortDirection === "asc" ? a.value - b.value : b.value - a.value;
    });
    return withValue.map((r) => r.kw);
  }, [filtered, sortColumn, sortDirection]);

  const allVisibleSelected = visible.length > 0 && visible.every((k) => selected.has(k.id));

  function cycleSort(column: Exclude<SortColumn, null>) {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
    } else if (sortDirection === "desc") {
      setSortColumn(null);
      setSortDirection(null);
    } else {
      setSortDirection("asc");
    }
  }

  function toggleOne(id: string, index: number, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedIndex != null) {
        const [start, end] = [lastClickedIndex, index].sort((a, b) => a - b);
        for (let i = start; i <= end; i++) {
          next.add(visible[i].id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastClickedIndex(index);
  }

  function toggleAll() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visible.forEach((k) => next.delete(k.id));
        return next;
      }
      const next = new Set(prev);
      visible.forEach((k) => next.add(k.id));
      return next;
    });
  }

  function flashUpdated(id: string) {
    setJustUpdatedIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setJustUpdatedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 2500);
  }

  async function checkOne(id: string) {
    setCheckingIds((prev) => new Set(prev).add(id));
    setErrors((prev) => ({ ...prev, [id]: "" }));

    const res = await fetch(`/api/keywords/${id}/check`, { method: "POST" }).catch(() => null);
    const outcome = await res?.json().catch(() => null);

    setErrors((prev) => ({ ...prev, [id]: outcome?.error ?? "" }));
    setCheckingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (!outcome?.error) flashUpdated(id);
    router.refresh();
  }

  async function removeOne(id: string) {
    if (!confirm("Remove this keyword?")) return;
    setRemovingId(id);
    await fetch(`/api/keywords/${id}`, { method: "DELETE" }).catch(() => null);
    setRemovingId(null);
    router.refresh();
  }

  async function clearErrorsFor(id: string) {
    setErrors((prev) => ({ ...prev, [id]: "" }));
    await fetch("/api/keywords/bulk-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], action: "clear-errors" }),
    }).catch(() => null);
    router.refresh();
  }

  async function bulkAction(
    action:
      | "check"
      | "clear-errors"
      | "remove"
      | "duplicate"
      | "duplicate-flip-device"
      | "add-tags"
      | "remove-tags"
      | "set-device",
    extra?: Record<string, unknown>
  ) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "remove" && !confirm(`Remove ${ids.length} selected keyword${ids.length === 1 ? "" : "s"}?`)) {
      return;
    }

    if (action === "check") {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }

    setBulkBusy(true);
    setActionsMenuOpen(false);
    setBulkNotice(null);

    if (action === "check") {
      // Checked in small batches so a big selection never runs as one long
      // request (and rows update as each batch finishes).
      const CHUNK = 5;
      let failStreak = 0;
      let checked = 0;
      let failed = 0;
      let haltedMsg: string | null = null;
      for (let i = 0; i < ids.length && !haltedMsg; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const res = await fetch("/api/keywords/bulk-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk, action }),
        }).catch(() => null);
        const body = await res?.json().catch(() => null);
        const outcomes =
          (body?.outcomes as { keywordId: string; error?: string; systemic?: boolean }[] | undefined) ?? [];
        if (!res?.ok) haltedMsg = body?.error ?? "Check stopped — the server didn't respond.";
        // Stop early when the provider is down or Google is blocking: the
        // same rule the server applies, carried across batches.
        for (const o of outcomes) {
          checked++;
          if (o.error) failed++;
          failStreak = o.error && o.systemic ? failStreak + 1 : 0;
          if (failStreak >= 3 && !haltedMsg) haltedMsg = `Stopped after 3 failed checks in a row — last error: ${o.error}`;
        }
        if (body?.halted && !haltedMsg) haltedMsg = body.halted;
        setErrors((prev) => {
          const next = { ...prev };
          outcomes.forEach((o) => (next[o.keywordId] = o.error ?? ""));
          return next;
        });
        outcomes.forEach((o) => {
          if (!o.error) flashUpdated(o.keywordId);
        });
        setCheckingIds((prev) => {
          const next = new Set(prev);
          chunk.forEach((id) => next.delete(id));
          return next;
        });
        router.refresh();
      }
      if (haltedMsg) {
        // Unchecked rows lose their spinners; nothing was charged for them.
        setCheckingIds(new Set());
        setBulkNotice(`${haltedMsg} — ${ids.length - checked} not checked.`);
      } else if (failed > 0) {
        setBulkNotice(`Checked ${checked} — ${failed} failed.`);
      }
    } else if (action === "clear-errors") {
      await fetch("/api/keywords/bulk-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      }).catch(() => null);
      setErrors((prev) => {
        const next = { ...prev };
        ids.forEach((id) => (next[id] = ""));
        return next;
      });
    } else {
      await fetch("/api/keywords/bulk-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action, ...extra }),
      }).catch(() => null);
    }
    setBulkBusy(false);

    setSelected(new Set());
    router.refresh();
  }

  async function moveSelectedToDomain(targetDomainId: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setMoveModalOpen(false);
    await fetch("/api/keywords/bulk-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "move-domain", targetDomainId }),
    }).catch(() => null);
    setBulkBusy(false);
    setSelected(new Set());
    router.refresh();
  }

  function addTagsPrompt() {
    const input = prompt(`Add tag(s) to ${selected.size} selected keyword(s) — comma separated:`);
    if (!input?.trim()) return;
    const tags = input.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length) bulkAction("add-tags", { tags });
  }

  function removeTagsPrompt() {
    const input = prompt(`Remove tag(s) from ${selected.size} selected keyword(s) — comma separated:`);
    if (!input?.trim()) return;
    const tags = input.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length) bulkAction("remove-tags", { tags });
  }

  function exportCsv(mode: "latest" | "history") {
    const csv = mode === "latest" ? toCsv(visible) : toFullHistoryCsv(visible);
    const suffix = mode === "latest" ? "latest" : "history";
    downloadCsv(csv, `keywords-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`);
    setExportMenuOpen(false);
  }

  if (keywords.length === 0) {
    return (
      <p className="text-sm text-muted py-6">
        Nothing tracked here yet. Add a keyword above to start recording its position.
      </p>
    );
  }

  return (
    <div className="md:min-w-[720px]">
      {bulkNotice && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-md border border-line bg-surface px-4 py-2 text-xs text-ink">
          <span>{bulkNotice}</span>
          <button onClick={() => setBulkNotice(null)} className="text-muted hover:text-ink shrink-0" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3 mb-1">
        <div className="flex items-center gap-4">
          {allTags.length > 0 ? (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="text-sm rounded-md border border-line bg-paper px-2.5 py-1.5 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <option value="all">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <span />
          )}
          {allTags.length > 0 && (
            <button onClick={() => setTagManagerOpen(true)} className="text-sm text-muted hover:text-accent">
              Manage tags
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm">
          {selected.size > 0 && (
            <>
              <span className="text-muted">{selected.size} selected</span>
              <div className="relative">
                <button
                  onClick={() => setActionsMenuOpen((v) => !v)}
                  disabled={bulkBusy}
                  className="flex items-center gap-1 text-accent hover:underline disabled:opacity-50"
                >
                  {bulkBusy && <Spinner />}
                  Actions ▾
                </button>
                {actionsMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActionsMenuOpen(false)} />
                    <div className="absolute right-0 mt-1 w-56 rounded-md border border-line bg-surface shadow-sm z-20 py-1">
                      <button
                        onClick={() => bulkAction("check")}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                      >
                        Check
                      </button>
                      <button
                        onClick={() => bulkAction("clear-errors")}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                        title="Delete failed-check records so rows show their last real result"
                      >
                        Clear errors
                      </button>
                      <button
                        onClick={() => bulkAction("duplicate")}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                      >
                        Duplicate
                      </button>
                      <button
                        onClick={() => bulkAction("duplicate-flip-device")}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                      >
                        Duplicate for other device
                      </button>
                      <div className="my-1 border-t border-line" />
                      <button
                        onClick={addTagsPrompt}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                      >
                        Add tags…
                      </button>
                      <button
                        onClick={removeTagsPrompt}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                      >
                        Remove tags…
                      </button>
                      <div className="my-1 border-t border-line" />
                      <button
                        onClick={() => bulkAction("set-device", { device: "desktop" })}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                      >
                        Set device: Desktop
                      </button>
                      <button
                        onClick={() => bulkAction("set-device", { device: "mobile" })}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                      >
                        Set device: Mobile
                      </button>
                      <div className="my-1 border-t border-line" />
                      <button
                        onClick={() => {
                          setActionsMenuOpen(false);
                          setMoveModalOpen(true);
                        }}
                        className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                      >
                        Move to domain…
                      </button>
                      <div className="my-1 border-t border-line" />
                      <button
                        onClick={() => bulkAction("remove")}
                        className="block w-full text-left px-3 py-1.5 text-xs text-fall hover:bg-paper"
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => setSelected(new Set())} className="text-muted hover:text-ink">
                Clear
              </button>
              <span className="text-line">|</span>
            </>
          )}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              className="text-muted hover:text-accent"
            >
              Export CSV ▾
            </button>
            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 mt-1 w-48 rounded-md border border-line bg-surface shadow-sm z-20 py-1">
                  <button
                    onClick={() => exportCsv("latest")}
                    className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                  >
                    Latest ranking
                  </button>
                  <button
                    onClick={() => exportCsv("history")}
                    className="block w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper"
                  >
                    Full history
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {tagManagerOpen && <TagManager domainId={domainId} onClose={() => setTagManagerOpen(false)} />}
      {moveModalOpen && (
        <MoveDomainModal
          currentDomainId={domainId}
          onClose={() => setMoveModalOpen(false)}
          onConfirm={moveSelectedToDomain}
        />
      )}

      <div className={`${desktopGridCols(!!gscMetrics)} border-b border-line pb-3 pt-5 text-sm text-muted`}>
        <input
          type="checkbox"
          checked={allVisibleSelected}
          onChange={toggleAll}
          className="accent-accent"
          aria-label="Select all"
        />
        <span>Keyword</span>
        <SortHeader
          label="Position"
          active={sortColumn === "position"}
          direction={sortColumn === "position" ? sortDirection : null}
          onClick={() => cycleSort("position")}
        />
        {gscMetrics && <span>Search Console</span>}
        <span>Trend</span>
        <span>Ranking URL</span>
        <SortHeader
          label="Last checked"
          active={sortColumn === "lastChecked"}
          direction={sortColumn === "lastChecked" ? sortDirection : null}
          onClick={() => cycleSort("lastChecked")}
        />
        <span />
        <span />
      </div>

      <div className="divide-y divide-line">
        {visible.map((kw, index) => {
          const [latest] = kw.checks;
          const good = completedChecks(kw.checks);
          const [lastGood, prevGood] = good;
          const latestFailed = latest?.error ?? null;
          const isChecking = checkingIds.has(kw.id);
          const isRemoving = removingId === kw.id;
          const justUpdated = justUpdatedIds.has(kw.id);
          // In-session error from a manual check, else the stored one from the last attempt.
          const error = errors[kw.id] || latestFailed;
          const city = cityLabel(kw.location);
          const gsc = gscMetrics?.[kw.term.toLowerCase()];

          const nameBlock = (
            <button
              onClick={() => setDrawerId(kw.id)}
              title="Show Google results and position history"
              className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
            >
              <div className="flex items-center gap-1.5">
                {isChecking && <Spinner className="text-muted shrink-0" />}
                {!isChecking && justUpdated && (
                  <span className="text-rise text-xs shrink-0" aria-label="Updated">
                    ✓
                  </span>
                )}
                <span className="text-sm text-ink">{kw.term}</span>
              </div>
              <div className="text-xs text-muted">
                {kw.country.toUpperCase()}
                {city ? ` · ${city}` : ""} · {kw.device}
              </div>
              {kw.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {kw.tags.map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-line text-muted">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );

          return (
            <div key={kw.id}>
              {/* Desktop row */}
              <div className={`${desktopGridCols(!!gscMetrics)} py-4`}>
                <input
                  type="checkbox"
                  checked={selected.has(kw.id)}
                  onClick={(e) => toggleOne(kw.id, index, e.shiftKey)}
                  onChange={() => {}}
                  className="accent-accent"
                  aria-label={`Select ${kw.term}`}
                />

                {nameBlock}

                <PositionCell
                  current={lastGood?.position ?? null}
                  previous={prevGood?.position ?? null}
                  maxCheckDepth={maxCheckDepth}
                  failedError={latestFailed}
                  hasCompleted={!!lastGood}
                />

                {gscMetrics && <GscCell gsc={gsc} />}

                <Sparkline values={good.slice().reverse().map((c) => c.position)} />

                <RankingUrlCell url={lastGood?.url} />

                {latest ? (
                  <RelativeTime iso={latest.checkedAt} className="text-xs text-muted cursor-default" />
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}

                <button
                  onClick={() => checkOne(kw.id)}
                  disabled={isChecking || isRemoving}
                  className="text-xs text-muted hover:text-accent disabled:opacity-50 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
                >
                  Check
                </button>

                <button
                  onClick={() => removeOne(kw.id)}
                  disabled={isChecking || isRemoving}
                  className="text-xs text-muted hover:text-fall disabled:opacity-50 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
                >
                  Remove
                </button>
              </div>

              {/* Mobile card — same data, stacked instead of columned */}
              <div className="md:hidden py-4 px-1 flex gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(kw.id)}
                  onClick={(e) => toggleOne(kw.id, index, e.shiftKey)}
                  onChange={() => {}}
                  className="accent-accent mt-1 shrink-0"
                  aria-label={`Select ${kw.term}`}
                />
                <div className="flex-1 min-w-0 space-y-2">
                  {nameBlock}

                  <div className="flex items-center justify-between gap-3">
                    <PositionCell
                      current={lastGood?.position ?? null}
                      previous={prevGood?.position ?? null}
                      maxCheckDepth={maxCheckDepth}
                      failedError={latestFailed}
                      hasCompleted={!!lastGood}
                    />
                    <Sparkline values={good.slice().reverse().map((c) => c.position)} />
                    {latest ? (
                      <RelativeTime iso={latest.checkedAt} className="text-xs text-muted cursor-default shrink-0" />
                    ) : (
                      <span className="text-xs text-muted shrink-0">—</span>
                    )}
                  </div>

                  {(lastGood?.url || gsc) && (
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <RankingUrlCell url={lastGood?.url} />
                      {gsc && (
                        <span className="text-muted shrink-0">
                          {formatCompact(gsc.clicks)} clicks · {formatCompact(gsc.impressions)} impr
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-4 pt-1">
                    <button
                      onClick={() => checkOne(kw.id)}
                      disabled={isChecking || isRemoving}
                      className="text-xs text-muted hover:text-accent disabled:opacity-50"
                    >
                      Check
                    </button>
                    <button
                      onClick={() => removeOne(kw.id)}
                      disabled={isChecking || isRemoving}
                      className="text-xs text-muted hover:text-fall disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="pb-3 -mt-1">
                  <p className="text-xs text-fall">
                    Check failed: {error}{" "}
                    <button
                      onClick={() => clearErrorsFor(kw.id)}
                      className="text-muted hover:text-ink underline underline-offset-2"
                      title="Delete this keyword's failed-check records"
                    >
                      clear
                    </button>
                  </p>
                </div>
              )}

            </div>
          );
        })}
      </div>
      {drawerId && (
        <KeywordDrawer keywordId={drawerId} maxCheckDepth={maxCheckDepth} onClose={() => setDrawerId(null)} />
      )}
    </div>
  );
}
