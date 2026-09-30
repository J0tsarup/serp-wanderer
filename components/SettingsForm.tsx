"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LocationInput from "./LocationInput";

export default function SettingsForm({
  currentProvider,
  currentSrTokenMasked,
  currentSrRender,
  currentKeyMasked,
  currentZone,
  currentCountry,
  currentLanguage,
  currentLocation,
  currentDepth,
}: {
  currentProvider: "brightdata" | "scrapingrobot";
  currentSrTokenMasked: string | null;
  currentSrRender: boolean;
  currentKeyMasked: string | null;
  currentZone: string;
  currentCountry: string;
  currentLanguage: string;
  currentLocation: string;
  currentDepth: number;
}) {
  const [provider, setProvider] = useState(currentProvider);
  const [srToken, setSrToken] = useState("");
  const [srRender, setSrRender] = useState(currentSrRender);
  const [apiKey, setApiKey] = useState("");
  const [zone, setZone] = useState(currentZone);
  const [country, setCountry] = useState(currentCountry);
  const [language, setLanguage] = useState(currentLanguage);
  const [location, setLocation] = useState(currentLocation);
  const [depth, setDepth] = useState(currentDepth);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serpProvider: provider,
        scrapingRobotToken: srToken, // blank = leave unchanged
        scrapingRobotRender: srRender,
        brightdataApiKey: apiKey, // blank = leave unchanged, see lib/settings.ts
        brightdataZone: zone,
        defaultCountry: country,
        defaultLanguage: language,
        defaultLocation: country === "us" ? location : "",
        maxCheckDepth: depth,
      }),
    });

    setLoading(false);
    if (!res.ok) {
      setError("Couldn't save settings — try again.");
      return;
    }
    setApiKey("");
    setSrToken("");
    setSaved(true);
    router.refresh();
  }

  const inputClasses =
    "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
  const labelClasses = "block text-sm text-ink mb-1";
  const helpClasses = "text-xs text-muted mt-1";

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className={labelClasses} htmlFor="provider">
          Rank-check provider
        </label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as "brightdata" | "scrapingrobot")}
          className={inputClasses}
        >
          <option value="brightdata">Bright Data (SERP API)</option>
          <option value="scrapingrobot">Scraping Robot</option>
        </select>
        <p className={helpClasses}>
          Which service fetches Google results. Credentials for both are kept, so you can switch
          back and forth. Positions and ranking URLs are worked out the same way for either.
        </p>
      </div>

      {provider === "scrapingrobot" && (
        <>
          <div>
            <label className={labelClasses} htmlFor="srToken">
              Scraping Robot API token
            </label>
            <input
              id="srToken"
              type="password"
              value={srToken}
              onChange={(e) => setSrToken(e.target.value)}
              placeholder={currentSrTokenMasked ? currentSrTokenMasked : "Paste your API token"}
              className={inputClasses}
              autoComplete="off"
            />
            <p className={helpClasses}>
              {currentSrTokenMasked
                ? "A token is already saved. Leave this blank to keep it, or paste a new one to replace it."
                : "From your Scraping Robot dashboard → API."}
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={srRender}
              onChange={(e) => setSrRender(e.target.checked)}
              className="accent-accent mt-0.5"
            />
            <span>
              Render JavaScript
              <span className="block text-xs text-muted">
                Uses Scraping Robot's browser module. In testing it timed out on Google (error 500), so
                leave it off unless that changes. Mobile keywords aren't supported with Scraping Robot.
              </span>
            </span>
          </label>
        </>
      )}

      {provider === "brightdata" && (
      <>
      <div>
        <label className={labelClasses} htmlFor="apiKey">
          Bright Data API key
        </label>
        <input
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={currentKeyMasked ? currentKeyMasked : "Paste your API key"}
          className={inputClasses}
          autoComplete="off"
        />
        <p className={helpClasses}>
          {currentKeyMasked
            ? "A key is already saved. Leave this blank to keep it, or paste a new one to replace it."
            : "From Bright Data → your account → SERP API zone."}
        </p>
      </div>

      <div>
        <label className={labelClasses} htmlFor="zone">
          Bright Data SERP zone name
        </label>
        <input
          id="zone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          placeholder="e.g. serp_zone1"
          className={inputClasses}
        />
      </div>
      </>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClasses} htmlFor="country">
            Default location
          </label>
          <select
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={inputClasses}
          >
            <option value="us">United States</option>
            <option value="in">India</option>
            <option value="gb">United Kingdom</option>
            <option value="ca">Canada</option>
            <option value="au">Australia</option>
          </select>
        </div>
        <div>
          <label className={labelClasses} htmlFor="language">
            Default language
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={inputClasses}
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="hi">Hindi</option>
          </select>
        </div>
      </div>

      {country === "us" && (
        <div>
          <label className={labelClasses} htmlFor="city">
            Default city (optional, US only)
          </label>
          <LocationInput id="city" value={location} onChange={setLocation} className={inputClasses} />
          <p className={helpClasses}>
            Narrows results to how Google looks from that specific city, rather than the US in
            general — useful for local SEO. Leave blank for country-level.
          </p>
        </div>
      )}

      <p className={helpClasses}>
        Used to prefill new keywords — you can still override the location per keyword when you
        add it.
      </p>

      <div>
        <label className={labelClasses} htmlFor="depth">
          Check depth
        </label>
        <select
          id="depth"
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          className={inputClasses}
        >
          <option value={10}>Top 10 (1 request per check)</option>
          <option value={30}>Top 30 (up to 3 requests per check)</option>
          <option value={50}>Top 50 (up to 5 requests per check)</option>
          <option value={100}>Top 100 (up to 10 requests per check)</option>
        </select>
        <p className={helpClasses}>
          How far into Google's results to look for your domain. Stops early the moment it's
          found — the "up to" figure is only the worst case, when a keyword isn't ranking at all.
          Deeper checking uses more credits per keyword and each extra request adds a few seconds.
          Refreshes run in batches, so deeper checks just take longer overall rather than timing out.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-ink text-white text-sm px-4 py-2 hover:bg-accent transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {loading ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-xs text-rise">Saved.</span>}
        {error && <span className="text-xs text-fall">{error}</span>}
      </div>
    </form>
  );
}
