import { HttpError, json, readJson } from "../http.mjs";
import { checkPassword } from "../security/password.mjs";
import { visitorIp } from "../security/visitor.mjs";
import { loadPaste } from "./load-paste.mjs";

/**
 * POST /paste/{slug}/unlock  - body: { authKey }
 *
 * If the password proof is right, hand over the encrypted text (the browser decrypts it).
 * A wrong proof is a 401. Too many wrong ones from one network is a 429 for that network only.
 */
export async function unlockPaste(event) {
  const paste = await loadPaste(event);
  if (paste.visibility !== "private") throw new HttpError(400, "Not a private paste");

  await checkPassword(paste, readJson(event).authKey, visitorIp(event));

  return json(200, {
    ciphertext: paste.ciphertext,
    language: paste.language,
    totalChars: paste.totalChars,
    filesMeta: paste.filesMeta,
  });
}
