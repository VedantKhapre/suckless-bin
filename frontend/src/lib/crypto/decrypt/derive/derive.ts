import { deriveMaster } from "../keys/pbkdf";
import { splitKeys } from "../keys/hkdf";

export async function deriveKeys(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ encKey: CryptoKey; authKey: ArrayBuffer }> {
  return splitKeys(await deriveMaster(password, salt));
}