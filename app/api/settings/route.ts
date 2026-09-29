import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings, maskSecret } from "@/lib/settings";
import { getSessionUser } from "@/lib/auth";

// Never statically prerendered — this route always reads/writes live
// database state, and some deployments run before the schema migration
// that adds newer columns has been applied, which would otherwise break
// the production build.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getSettings(user.id);
  return NextResponse.json({
    serpProvider: settings.serpProvider,
    scrapingRobotTokenMasked: maskSecret(settings.scrapingRobotToken),
    scrapingRobotRender: settings.scrapingRobotRender,
    brightdataApiKeyMasked: maskSecret(settings.brightdataApiKey),
    brightdataZone: settings.brightdataZone, // zone names aren't secret, safe to show in full
    defaultCountry: settings.defaultCountry,
    defaultLanguage: settings.defaultLanguage,
    defaultLocation: settings.defaultLocation,
    maxCheckDepth: settings.maxCheckDepth,
    resendApiKeyMasked: maskSecret(settings.resendApiKey),
    digestEmail: settings.digestEmail,
    digestEnabled: settings.digestEnabled,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  await updateSettings(user.id, {
    serpProvider: body.serpProvider as string | undefined,
    scrapingRobotToken: (body.scrapingRobotToken as string | undefined)?.trim(),
    scrapingRobotRender: typeof body.scrapingRobotRender === "boolean" ? body.scrapingRobotRender : undefined,
    brightdataApiKey: (body.brightdataApiKey as string | undefined)?.trim(),
    brightdataZone: (body.brightdataZone as string | undefined)?.trim(),
    defaultCountry: (body.defaultCountry as string | undefined)?.trim().toLowerCase(),
    defaultLanguage: (body.defaultLanguage as string | undefined)?.trim().toLowerCase(),
    defaultLocation: (body.defaultLocation as string | undefined)?.trim(),
    maxCheckDepth: Number(body.maxCheckDepth) || undefined,
    resendApiKey: (body.resendApiKey as string | undefined)?.trim(),
    digestEmail: (body.digestEmail as string | undefined)?.trim(),
    digestEnabled: typeof body.digestEnabled === "boolean" ? body.digestEnabled : undefined,
  });

  return NextResponse.json({ ok: true });
}
