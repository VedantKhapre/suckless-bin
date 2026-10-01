import type { FileMeta } from "./collect";

export const API = "http://localhost:8787";

export type PasteMeta = {
  visibility: "public" | "private";
  title: string;
  expiresAt: number;
  language?: string;
  totalChars?: number;
  filesMeta?: FileMeta[];
  text?: string;
  salt?: string;
  iv?: string;
};

const UPDATE = "paste:update";

export async function sendPaste(payload: object): Promise<{ slug: string }> {
  const res = await fetch(`${API}/paste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

export async function sendFile(
  slug: string,
  index: number,
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
) {
  const res = await fetch(`${API}/paste/${slug}/file/${index}`, {
    method: "PUT",
    body: bytes,
  });
  if (!res.ok) throw new Error("File upload failed");
}

const cache = new Map<string, Promise<PasteMeta>>();

export function getPaste(slug: string): Promise<PasteMeta> {
  let request = cache.get(slug);
  if (!request) {
    request = fetch(`${API}/paste/${slug}`).then((res) => {
      if (!res.ok) throw new Error(
        String.raw
          `
      ______________________________________
     / Holy cow! This paste is gone. Either \
     | 404 ate it or time turned it into    |
     \ cheese.                              /
      --------------------------------------
             \   ^__^
              \  (oo)\_______
                 (__)\       )\/\
                     ||----w |
                     ||     ||
          `
      );
      return res.json();
    });
    cache.set(slug, request);
    request.catch(() => cache.delete(slug));
  }
  return request;
}

export function setPaste(slug: string, paste: PasteMeta) {
  cache.set(slug, Promise.resolve(paste));
  window.dispatchEvent(new CustomEvent<PasteMeta>(UPDATE, { detail: paste }));
}

export function watchPaste(
  onPaste: (paste: PasteMeta) => void,
  onError?: () => void,
) {
  const listener = (event: Event) =>
    onPaste((event as CustomEvent<PasteMeta>).detail);

  getPaste(getSlug()).then(onPaste, onError);
  window.addEventListener(UPDATE, listener);
  return () => window.removeEventListener(UPDATE, listener);
}

export const getSlug = () =>
  new URLSearchParams(location.search).get("s") ??
  location.pathname.split("/").filter(Boolean).pop() ??
  "";