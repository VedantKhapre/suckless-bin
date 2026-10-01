import type { FileMeta } from "../collect";

export type PublicPastePayload = {
  visibility: "public";
  title: string;
  expiration: string;
  language: string;
  text: string;
  totalChars: number;
  filesMeta: FileMeta[];
};
export type PublicPayload = {
  salt: string;
  iv: string;
  authKey: string;
  ciphertext: string;
};