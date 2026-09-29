// Google's `uule` location parameter, encoded form: "w+CAIQICI" + one
// character giving the canonical name's byte length (indexed into the base64
// alphabet) + the canonical name base64-encoded without padding.
// e.g. "Paris,Ile-de-France,France" (26 bytes) -> "w+CAIQICIaUGFyaXMsSWxlLWRlLUZyYW5jZSxGcmFuY2U".
//
// Bright Data accepts the plain canonical name and encodes it itself; Google
// (and so any raw-HTML provider like Scraping Robot) needs this encoded form.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function encodeUule(canonicalName: string): string {
  const bytes = Buffer.from(canonicalName, "utf8");
  const lengthChar = ALPHABET[bytes.length % ALPHABET.length];
  const b64 = bytes.toString("base64").replace(/=+$/, "");
  return `w+CAIQICI${lengthChar}${encodeURIComponent(b64)}`;
}
