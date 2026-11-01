import { json } from "../http.mjs";
import { loadPaste } from "./load-paste.mjs";

/**
 * GET /paste/{slug}  - open a paste.
 *
 * Public: everything. Private: only what the browser needs to ask for a password.
 * The secret parts (ciphertext, file list) are not sent until the password is proven.
 */
export async function getPaste(event) {
  const paste = await loadPaste(event);

  if (paste.visibility === "private") {
    return json(200, {
      visibility: paste.visibility,
      title: paste.title,
      expiresAt: paste.expiresAt,
      salt: paste.salt,
      iv: paste.iv,
    });
  }

  return json(200, {
    visibility: paste.visibility,
    title: paste.title,
    expiresAt: paste.expiresAt,
    language: paste.language,
    totalChars: paste.totalChars,
    filesMeta: paste.filesMeta,
    text: paste.text,
  });
}
