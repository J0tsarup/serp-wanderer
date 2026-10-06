import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings, maskSecret } from "@/lib/settings";
import { getSessionUser } from "@/lib/auth";
import SettingsForm from "@/components/SettingsForm";
import BalanceDisplay from "@/components/BalanceDisplay";
import GoogleConnectionForm from "@/components/GoogleConnectionForm";
import DigestSettingsForm from "@/components/DigestSettingsForm";
import SettingsTabs from "@/components/SettingsTabs";

export const metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { google_error?: string; google_connected?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [settings, googleConn] = await Promise.all([
    getSettings(user.id),
    prisma.googleConnection.findUnique({ where: { userId: user.id } }),
  ]);

  const cameFromGoogle = !!(searchParams.google_error || searchParams.google_connected);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
      </div>

      <SettingsTabs
        initialTab={cameFromGoogle ? "searchconsole" : "brightdata"}
        brightData={
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Which service runs rank checks, its credentials, and your default search location.
              Stored in the database — nothing to configure in env vars for day-to-day use.
            </p>
            {settings.serpProvider === "brightdata" && (
              <BalanceDisplay hasApiKey={!!settings.brightdataApiKey} />
            )}
            <SettingsForm
              currentProvider={settings.serpProvider}
              currentSrTokenMasked={maskSecret(settings.scrapingRobotToken)}
              currentSrRender={settings.scrapingRobotRender}
              currentKeyMasked={maskSecret(settings.brightdataApiKey)}
              currentZone={settings.brightdataZone ?? ""}
              currentCountry={settings.defaultCountry}
              currentLanguage={settings.defaultLanguage}
              currentLocation={settings.defaultLocation ?? ""}
              currentDepth={settings.maxCheckDepth}
            />
          </div>
        }
        searchConsole={
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Connect Google Search Console for clicks, impressions, and Discover performance —
              separate from Bright Data's rank checks.
            </p>
            {searchParams.google_error && (
              <p className="text-xs text-fall">{decodeURIComponent(searchParams.google_error)}</p>
            )}
            {searchParams.google_connected && <p className="text-xs text-rise">Connected to Google.</p>}
            <GoogleConnectionForm
              hasClientId={!!googleConn?.clientId}
              isConnected={!!googleConn?.accessToken}
              selectedSite={googleConn?.siteUrl ?? null}
            />
          </div>
        }
        digest={
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Requires Search Console to be connected. Sends the last 7 days' top queries every
              Monday.
            </p>
            <DigestSettingsForm
              currentKeyMasked={maskSecret(settings.resendApiKey)}
              currentEmail={settings.digestEmail ?? ""}
              currentEnabled={settings.digestEnabled}
            />
          </div>
        }
      />
    </div>
  );
}
