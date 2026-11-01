import { env } from "../config.mjs";
import { HttpError } from "../http.mjs";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Must match `action` in the browser widget (frontend/src/lib/turnstile/client.ts). */
export const CREATE_ACTION = "create-paste";

/**
 * Ask Cloudflare whether this Turnstile token is real.
 * Tokens work once and expire after 5 minutes.
 * If Cloudflare cannot be reached we refuse (503): safer than letting bots through.
 */
export async function verifyTurnstile(token, visitorAddress) {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    throw new HttpError(403, "Verification required");
  }

  const form = new URLSearchParams({ secret: env.turnstileSecret, response: token });
  if (typeof visitorAddress === "string" && visitorAddress) form.set("remoteip", visitorAddress);

  let result;
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`siteverify answered ${res.status}`);
    result = await res.json();
  } catch (error) {
    console.error(JSON.stringify({ message: "turnstile unreachable", error: String(error) }));
    throw new HttpError(503, "Verification service unavailable");
  }

  if (!result?.success || result.action !== CREATE_ACTION) {
    // Cloudflare says why in result["error-codes"]; shown in the logs only, never to the visitor.
    console.error(JSON.stringify({ message: "turnstile rejected", codes: result?.["error-codes"] ?? [] }));
    throw new HttpError(403, "Verification failed");
  }
}
