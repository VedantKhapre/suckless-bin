import { API, getPaste, setPaste, type PasteMeta } from "../api";
import type { FileMeta } from "../collect";
import { deriveKeys } from "../../crypto/decrypt/derive/derive";
import { decryptText } from "../../crypto/decrypt/aes/decrypt";
import { b64, unb64 } from "../../crypto/shared/base64";

type UnlockResponse = {
  ciphertext: string;
  language: string;
  totalChars: number;
  filesMeta: FileMeta[];
};

// In memory only, gone on reload
const authKeys = new Map<string, ArrayBuffer>();
export const getAuthKey = (slug: string) => authKeys.get(slug);

export async function unlock(slug: string, password: string) {
  const meta = await getPaste(slug);
  if (!meta.salt || !meta.iv) throw new Error("Not a private paste");

  const { encKey, authKey } = await deriveKeys(password, unb64(meta.salt));

  const res = await fetch(`${API}/paste/${slug}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authKey: b64(authKey) }),
  });
  if (!res.ok) throw new Error("Wrong password");

  const { ciphertext, ...rest }: UnlockResponse = await res.json();
  const text = await decryptText(
    encKey,
    unb64(meta.iv),
    unb64(ciphertext).buffer,
  );

  authKeys.set(slug, authKey);

  const full: PasteMeta = { ...meta, ...rest, text };
  setPaste(slug, full);
}