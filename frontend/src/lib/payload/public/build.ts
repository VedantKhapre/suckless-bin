import type { CreatePublicPasteRequest } from "@/lib/api";
import type { Collected } from "../collect";

export function buildPublicPayload(c: Collected): CreatePublicPasteRequest {
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