import { AUTH_LABEL, ENC_LABEL } from "../../shared/constants";

const text = new TextEncoder();

export async function splitKeys(
  master: ArrayBuffer,
): Promise<{ encKey: CryptoKey; authKey: ArrayBuffer }> {
  const hkdf = await crypto.subtle.importKey("raw", master, "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ]);

  const authKey = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: text.encode(AUTH_LABEL),
    },
    hkdf,
    256,
  );

  const encKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: text.encode(ENC_LABEL),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return { encKey, authKey };
}