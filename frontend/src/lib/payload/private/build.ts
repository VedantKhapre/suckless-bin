import type { Collected, FileMeta } from "../collect";
import type { PublicPayload } from "../public/types";
import { getSalt } from "../../crypto/encrypt/random/salt";
import { getIv } from "../../crypto/encrypt/random/iv";
import { deriveMaster } from "../../crypto/encrypt/keys/pbkdf";
import { splitKeys } from "../../crypto/encrypt/keys/hkdf";
import { encryptText } from "../../crypto/encrypt/aes/encrypt";
import { b64 } from "../../crypto/shared/base64";

export type PrivateSendPayload = PublicPayload & {
  visibility: "private";
  expiration: string;
  title: string;
  language: string;
  totalChars: number;
  filesMeta: FileMeta[];
};

export async function buildPrivatePayload(
  c: Collected,
): Promise<PrivateSendPayload> {
  if (!c.password) throw new Error("Password required for private paste");

  const salt = getSalt();
  const iv = getIv();
  const { encKey, authKey } = await splitKeys(
    await deriveMaster(c.password, salt),
  );

  const ciphertext = await encryptText(encKey, iv, c.text);

  return {
    visibility: "private",
    expiration: c.expiration,
    title: c.title,
    language: c.language,
    totalChars: c.totalChars,
    filesMeta: c.filesMeta,
    salt: b64(salt),
    iv: b64(iv),
    authKey: b64(authKey),
    ciphertext: b64(ciphertext),
  };
}