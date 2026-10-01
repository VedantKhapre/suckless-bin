import type { Collected } from "../collect";
import type { PublicPastePayload } from "./types";

export function buildPublicPayload(c: Collected): PublicPastePayload {
  return {
    visibility: "public",
    title: c.title,
    expiration: c.expiration,
    language: c.language,
    text: c.text,
    totalChars: c.totalChars,
    filesMeta: c.filesMeta,
  };
}