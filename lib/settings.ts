import { prisma } from "./db";

const VALID_DEPTHS = [10, 30, 50, 100];

export type ResolvedSettings = {
  brightdataApiKey: string | null;
  brightdataZone: string | null;
  defaultCountry: string;
  defaultLanguage: string;
  defaultLocation: string | null;
  maxCheckDepth: number;
  resendApiKey: string | null;
  digestEmail: string | null;
  digestEnabled: boolean;
};

/**
 * Read a user's own settings. If a value hasn't been filled in on the
 * Settings page, falls back to the matching environment variable — so a
 * deployment can still be configured entirely through env vars if preferred
 * (env vars are shared across all users on the deployment, since they're
 * not per-account).
 */
export async function getSettings(userId: string): Promise<ResolvedSettings> {
  const row = await prisma.settings.findUnique({ where: { userId } });

  return {
    brightdataApiKey: row?.brightdataApiKey || process.env.BRIGHTDATA_API_KEY || null,
    brightdataZone: row?.brightdataZone || process.env.BRIGHTDATA_SERP_ZONE || null,
    defaultCountry: row?.defaultCountry || "us",
    defaultLanguage: row?.defaultLanguage || "en",
    defaultLocation: row?.defaultLocation || null,
    maxCheckDepth: row?.maxCheckDepth && VALID_DEPTHS.includes(row.maxCheckDepth) ? row.maxCheckDepth : 10,
    resendApiKey: row?.resendApiKey || null,
    digestEmail: row?.digestEmail || null,
    digestEnabled: row?.digestEnabled ?? false,
  };
}

/**
 * Update a user's settings. Blank/omitted fields for the secret values are
 * treated as "leave unchanged" so the form never needs to round-trip the
 * real key back to the browser just to preserve it.
 */
export async function updateSettings(
  userId: string,
  input: {
    brightdataApiKey?: string;
    brightdataZone?: string;
    defaultCountry?: string;
    defaultLanguage?: string;
    defaultLocation?: string;
    maxCheckDepth?: number;
    resendApiKey?: string;
    digestEmail?: string;
    digestEnabled?: boolean;
  }
) {
  const existing = await prisma.settings.findUnique({ where: { userId } });
  const depth = input.maxCheckDepth && VALID_DEPTHS.includes(input.maxCheckDepth) ? input.maxCheckDepth : undefined;

  return prisma.settings.upsert({
    where: { userId },
    create: {
      userId,
      brightdataApiKey: input.brightdataApiKey || null,
      brightdataZone: input.brightdataZone || null,
      defaultCountry: input.defaultCountry || "us",
      defaultLanguage: input.defaultLanguage || "en",
      defaultLocation: input.defaultLocation || null,
      maxCheckDepth: depth ?? 10,
      resendApiKey: input.resendApiKey || null,
      digestEmail: input.digestEmail || null,
      digestEnabled: input.digestEnabled ?? false,
    },
    update: {
      brightdataApiKey: input.brightdataApiKey ? input.brightdataApiKey : existing?.brightdataApiKey,
      brightdataZone: input.brightdataZone ? input.brightdataZone : existing?.brightdataZone,
      defaultCountry: input.defaultCountry || existing?.defaultCountry || "us",
      defaultLanguage: input.defaultLanguage || existing?.defaultLanguage || "en",
      // Explicit empty string clears the default city; undefined (field omitted) leaves it unchanged.
      defaultLocation: input.defaultLocation !== undefined ? input.defaultLocation || null : existing?.defaultLocation,
      maxCheckDepth: depth ?? existing?.maxCheckDepth ?? 10,
      resendApiKey: input.resendApiKey ? input.resendApiKey : existing?.resendApiKey,
      digestEmail: input.digestEmail !== undefined ? input.digestEmail || null : existing?.digestEmail,
      digestEnabled: input.digestEnabled ?? existing?.digestEnabled ?? false,
    },
  });
}

/** "brd_a1b2c3..." -> "••••••c3d4" — enough to confirm which key is saved without exposing it. */
export function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "•".repeat(value.length);
  return "••••" + value.slice(-4);
}
