/**
 * Error from a SERP provider (Bright Data, Scraping Robot) — its message is
 * shown to the user as-is.
 *
 * - `retryable`: worth another attempt on the same keyword (block, timeout).
 * - `systemic`: likely to hit every keyword right now (outage, block, bad
 *   credentials), so a batch should stop rather than keep going. False for
 *   keyword-specific problems like an unsupported device.
 */
export class SerpProviderError extends Error {
  status?: number;
  retryable = false;
  systemic: boolean;
  constructor(message: string, status?: number, opts?: { systemic?: boolean }) {
    super(message);
    this.name = "SerpProviderError";
    this.status = status;
    this.systemic = opts?.systemic ?? true;
  }
}
