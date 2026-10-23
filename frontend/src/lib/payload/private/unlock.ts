import { getPaste, setAuthKey, setPaste, unlockPaste } from "@/lib/api";
import { deriveKeys } from "../../crypto/decrypt/derive/derive";
import { decryptText } from "../../crypto/decrypt/aes/decrypt";
import { b64, unb64 } from "../../crypto/shared/base64";

export async function unlock(slug: string, password: string) {
  const meta = await getPaste(slug);
  if (!meta.salt || !meta.iv) throw new Error("Not a private paste");

  const { encKey, authKey } = await deriveKeys(password, unb64(meta.salt));

  const { ciphertext, ...rest } = await unlockPaste(slug, b64(authKey));
  const text = await decryptText(
    encKey,
    unb64(meta.iv),
    unb64(ciphertext).buffer,
  );

  setAuthKey(slug, authKey);
  setPaste(slug, { ...meta, ...rest, text });
}