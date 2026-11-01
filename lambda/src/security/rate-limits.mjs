import { createHmac } from "node:crypto";
import { UNLOCK_WINDOW_MS, dailyPasteLimit, unlockMaxAttempts, env } from "../config.mjs";
import { addToCounter, giveBackOne } from "../data/counters.mjs";
import { HttpError } from "../http.mjs";
import { networkOf } from "./visitor.mjs";

/**
 * Two limits, both counted per visitor network:
 *   1. how many pastes a network may create per day
 *   2. how many password attempts a network gets per paste (per 15 minutes)
 *
 * Counters live in DynamoDB under keys like "rl#<hash>#<day>". The visitor's address is
 * hashed, so no IP is stored. "#" can never appear in a real link, so a counter cannot
 * be fetched through the API.
 */

const DAY_MS = 86_400_000;

/** A short fingerprint of a value. Not reversible without the secret pepper. */
const fingerprint = (label, value) =>
  createHmac("sha256", env.pepper).update(`${label}:${value}`).digest("hex").slice(0, 32);

/** Count one paste creation for this network today. Throws 429 when today's limit is used up. */
export async function countDailyCreate(ip) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10).replaceAll("-", ""); // e.g. 20261030 (UTC)
  const key = `rl#${fingerprint("create", networkOf(ip))}#${day}`;
  const nextMidnight = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
  const ttl = Math.floor(nextMidnight / 1000) + 3600; // DynamoDB tidies it up after the day ends
  const limit = dailyPasteLimit();

  if (!(await addToCounter(key, limit, ttl))) {
    throw new HttpError(429, `Daily limit reached: ${limit} pastes per day. It resets at 00:00 UTC.`);
  }
}

/**
 * Use up one password attempt for this paste from this network, or throw 429.
 *
 * The attempt is counted BEFORE the password is checked. That matters: if we counted
 * afterwards, 50 guesses sent at the same instant would all be checked before any were
 * counted. Returns `refund()`: call it when the password was right, so correct logins are free.
 *
 * The key mixes the paste and the network, so pausing one network never affects anyone else.
 */
export async function useUpPasswordAttempt(slug, ip) {
  const now = Date.now();
  const window = Math.floor(now / UNLOCK_WINDOW_MS);
  const windowEnd = (window + 1) * UNLOCK_WINDOW_MS;
  const key = `ul#${fingerprint("unlock", `${slug}:${networkOf(ip)}`)}#${window}`;
  const ttl = Math.floor(windowEnd / 1000) + 3600;

  if (!(await addToCounter(key, unlockMaxAttempts(), ttl))) {
    const minutes = Math.max(1, Math.ceil((windowEnd - now) / 60_000));
    throw new HttpError(
      429,
      `Too many wrong passwords from your network. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }
  return () => giveBackOne(key);
}
