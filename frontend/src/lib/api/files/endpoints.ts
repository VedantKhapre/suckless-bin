/*
This module defines the file upload and file download endpoints.
*/

import { b64 } from "../../crypto/shared/base64";
import ApiError from "../core/errors";
import { requestBytes, sendBytes } from "../core/http";
import { getAuthKey } from "../paste/session";
import { getPaste } from "../paste/store";

// The slug is encoded fot a URL path. The index is a number.
const filePath = (slug: string, index: number) =>
  `/paste/${encodeURIComponent(slug)}/file/${index}`;

// uploadFile sends one file to the server.
// It returns a Promise<void>
// uploadFile does not send the auth key.
// If the authorization is requested for uploads, this function must send the auth key or another header but its a future implementation :P
export const uploadFile = (
  slug: string,
  index: number,
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
) => sendBytes(filePath(slug, index), bytes);

// fetchFileBytes downloads one file.
// If the paste is public, it sends a normal GET request.
// If the paste is private, it reads the auth key from session.ts.
// If there is no auth key, it throws ApiError("unauthorized", "Unlock the paste first").
export async function fetchFileBytes(
  slug: string,
  index: number,
): Promise<ArrayBuffer> {
  const paste = await getPaste(slug);

  if (paste.visibility === "public") {
    return requestBytes(filePath(slug, index));
  }

  const authKey = getAuthKey(slug);
  if (!authKey) throw new ApiError("unauthorized", "Unlock the paste first");

  return requestBytes(filePath(slug, index), {
    method: "POST",
    json: { authKey: b64(authKey) },
  });
}
