import { MAX_FILE_BYTES } from "../config.mjs";
import { saveFile } from "../data/file-store.mjs";
import { HttpError, json, readBytes } from "../http.mjs";
import { getFileIndex } from "../validate.mjs";
import { loadPaste } from "./load-paste.mjs";

/**
 * PUT /paste/{slug}/file/{index}  - body: the raw file
 *
 * The browser calls this once per file, right after creating the paste.
 * The file must be exactly the size it declared, and a slot can only be filled once.
 */
export async function uploadFile(event) {
  const paste = await loadPaste(event);
  const index = getFileIndex(event, paste.filesMeta);

  const file = readBytes(event, MAX_FILE_BYTES);
  if (file.length !== paste.filesMeta[index].size) {
    throw new HttpError(400, "File size does not match what was declared");
  }

  if (!(await saveFile(paste.slug, index, file))) {
    throw new HttpError(409, "File already uploaded");
  }
  return json(200, { ok: true });
}
