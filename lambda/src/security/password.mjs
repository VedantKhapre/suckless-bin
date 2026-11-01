import { createHmac, timingSafeEqual } from "node:crypto";
import { AUTH_KEY_BYTES, env } from "../config.mjs";
import { HttpError } from "../http.mjs";
import { useUpPasswordAttempt } from "./rate-limits.mjs";

/**
 * HOW PRIVATE PASTES ARE PROTECTED
 *
 * The browser turns the password into two keys. One encrypts the text and never leaves
 * the browser. The other, the "auth key", is sent to us as proof the visitor knows the password.
 *
 * We never store the auth key itself, only HMAC-SHA256(secret pepper, auth key).
 *  - A leaked table cannot be used to check password guesses: the pepper is not in it.
 *  - The key is already 256 random-looking bits, so a slow hash would add nothing.
 * (Changing the pepper makes every existing private paste unreadable. They live 8 hours at most.)
 */
export const hashAuthKey = (authKey) =>
  createHmac("sha256", env.pepper).update(authKey).digest();

/** Does this auth key match the stored hash? Compared in constant time. */
function matchesStoredHash(storedHashBase64, authKeyBase64) {
  if (typeof storedHashBase64 !== "string" || typeof authKeyBase64 !== "string") return false;

  const given = Buffer.from(authKeyBase64, "base64");
  if (given.length !== AUTH_KEY_BYTES) return false;

  const expected = Buffer.from(storedHashBase64, "base64");
  const actual = hashAuthKey(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Check a visitor's password proof. Throws 401 if wrong.
 * Each attempt is counted per network (see rate-limits.mjs). A paste is never locked for
 * everyone: someone guessing wrong cannot stop the right password working for other people.
 */
export async function checkPassword(paste, authKeyBase64, visitorAddress) {
  const refund = await useUpPasswordAttempt(paste.slug, visitorAddress);
  if (!matchesStoredHash(paste.authHash, authKeyBase64)) {
    throw new HttpError(401, "Wrong password");
  }
  await refund(); // correct passwords never use up the budget
}
