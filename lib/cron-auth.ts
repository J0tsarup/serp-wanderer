import type { NextRequest } from "next/server";

/**
 * Cron endpoints accept CRON_SECRET either as the Authorization header
 * (Vercel Cron sends it automatically) or as ?secret=… (for schedulers like
 * Render's that can't set headers). No secret configured = always refused.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}
