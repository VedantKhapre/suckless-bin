import { readFile } from "../data/file-store.mjs";
import { HttpError, bytes, readJson } from "../http.mjs";
import { checkPassword } from "../security/password.mjs";
import { visitorIp } from "../security/visitor.mjs";
import { getFileIndex } from "../validate.mjs";
import { loadPaste } from "./load-paste.mjs";

async function sendFile(paste, index) {
  const file = await readFile(paste.slug, index);
  if (!file) throw new HttpError(404, "File not found");
  return bytes(file);
}

/** GET /paste/{slug}/file/{index}  - files of a PUBLIC paste. Anyone with the link can download. */
export async function downloadPublicFile(event) {
  const paste = await loadPaste(event);
  if (paste.visibility !== "public") throw new HttpError(401, "Unlock the paste first");

  return sendFile(paste, getFileIndex(event, paste.filesMeta));
}

/** POST /paste/{slug}/file/{index}  - files of a PRIVATE paste. Body: { authKey } proves the password. */
export async function downloadPrivateFile(event) {
  const paste = await loadPaste(event);
  if (paste.visibility !== "private") throw new HttpError(400, "Not a private paste");
  const index = getFileIndex(event, paste.filesMeta);

  await checkPassword(paste, readJson(event).authKey, visitorIp(event));
  return sendFile(paste, index);
}
