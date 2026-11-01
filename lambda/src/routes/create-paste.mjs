import { TTL_GRACE_SECONDS } from "../config.mjs";
import { savePaste } from "../data/paste-store.mjs";
import { HttpError, json, readJson } from "../http.mjs";
import { hashAuthKey } from "../security/password.mjs";
import { countDailyCreate } from "../security/rate-limits.mjs";
import { verifyTurnstile } from "../security/turnstile.mjs";
import { visitorIp } from "../security/visitor.mjs";
import { newSlug } from "../slug.mjs";
import { parseNewPaste } from "../validate.mjs";

/**
 * POST /paste  - create a paste.
 *
 * The order matters. Cheap checks come first, so bad requests never cost anything:
 *   1. read and validate the request
 *   2. check the Turnstile token (a real person, not a bot)
 *   3. count this visitor's pastes for today (max 5)
 *   4. save it and answer with the new link
 */
export async function createPaste(event) {
  const body = readJson(event);
  const paste = parseNewPaste(body);

  const ip = visitorIp(event);
  await verifyTurnstile(body.turnstileToken, ip);
  await countDailyCreate(ip);

  const item = toStoredItem(paste);

  // A new random link is almost never taken; retry a few times just in case.
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = newSlug();
    if (await savePaste({ slug, ...item })) return json(201, { slug });
  }
  throw new HttpError(503, "Could not allocate a link, try again");
}

/** What we write to DynamoDB. Public pastes keep the text; private ones keep ciphertext + a password hash. */
function toStoredItem(paste) {
  const createdAt = Date.now();
  const expiresAt = createdAt + paste.minutes * 60_000;

  const shared = {
    visibility: paste.visibility,
    title: paste.title,
    expiration: paste.expiration,
    language: paste.language,
    totalChars: paste.totalChars,
    filesMeta: paste.filesMeta,
    createdAt,
    expiresAt,
    ttl: Math.floor(expiresAt / 1000) + TTL_GRACE_SECONDS, // DynamoDB deletes it after this
  };

  if (paste.visibility === "public") return { ...shared, text: paste.text };

  return {
    ...shared,
    salt: paste.salt,
    iv: paste.iv,
    ciphertext: paste.ciphertext,
    authHash: hashAuthKey(paste.authKey).toString("base64"), // never the auth key itself
  };
}
