"use client";

import { useState } from "react";

type Tab = "brightdata" | "searchconsole" | "digest";

export default function SettingsTabs({
  initialTab = "brightdata",
  brightData,
  searchConsole,
  digest,
}: {
  initialTab?: Tab;
  brightData: React.ReactNode;
  searchConsole: React.ReactNode;
  digest: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabs: { id: Tab; label: string }[] = [
    { id: "brightdata", label: "Rank checks" },
    { id: "searchconsole", label: "Search Console" },
    { id: "digest", label: "Email digest" },
  ];

  return (
    <div className="flex flex-col md:flex-row gap-6 md:gap-8">
      <nav className="flex md:flex-col gap-1 md:w-40 shrink-0 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-left text-sm px-3 py-2 rounded-md whitespace-nowrap ${
              tab === t.id ? "bg-line/60 text-ink font-medium" : "text-muted hover:text-ink hover:bg-line/30"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0 max-w-lg">
        {tab === "brightdata" && brightData}
        {tab === "searchconsole" && searchConsole}
        {tab === "digest" && digest}
      </div>
    </div>
  );
}
