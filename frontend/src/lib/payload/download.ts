import { API, getPaste, getSlug } from "./api";
import type { FileMeta } from "./collect";
import { getAuthKey } from "./private/unlock";
import { b64 } from "../crypto/shared/base64";

async function fetchBytes(slug: string, index: number): Promise<ArrayBuffer> {
  const paste = await getPaste(slug);
  const url = `${API}/paste/${slug}/file/${index}`;

  if (paste.visibility === "public") {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Download failed");
    return res.arrayBuffer();
  }

  const authKey = getAuthKey(slug);
  if (!authKey) throw new Error("Unlock the paste first");

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authKey: b64(authKey) }),
  });
  if (!res.ok) throw new Error("Download failed");
  return res.arrayBuffer();
}

export async function downloadFile(file: FileMeta, index: number) {
  const bytes = await fetchBytes(getSlug(), index);
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));

  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}