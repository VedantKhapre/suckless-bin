import { getLivePaste } from "../data/paste-store.mjs";
import { HttpError } from "../http.mjs";
import { getSlug } from "../validate.mjs";

/**
 * Used by every route that works on an existing paste: read the link from the URL and load
 * the paste. A missing, expired or malformed link all answer the same 404.
 */
export async function loadPaste(event) {
  const paste = await getLivePaste(getSlug(event));
  if (!paste) throw new HttpError(404, "Paste not found");
  return paste;
}
