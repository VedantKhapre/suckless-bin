export async function decryptText(
  encKey: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  ciphertext: ArrayBuffer,
): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    encKey,
    ciphertext,
  );
  return new TextDecoder().decode(plain);
}