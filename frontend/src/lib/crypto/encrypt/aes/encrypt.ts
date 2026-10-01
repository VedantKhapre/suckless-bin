export function encryptText(
  encKey: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  text: string,
): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encKey,
    new TextEncoder().encode(text),
  );
}