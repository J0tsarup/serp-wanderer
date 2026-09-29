/** Error from a SERP provider (Bright Data, Scraping Robot) — its message is shown to the user as-is. */
export class SerpProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SerpProviderError";
    this.status = status;
  }
}
