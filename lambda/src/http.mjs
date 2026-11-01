import { MAX_REQUEST_BYTES } from "./config.mjs";

/** Throw this to answer with a specific status. The message is shown to the visitor. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// CORS headers are added by API Gateway, not here.
const baseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

/** A JSON answer. */
export const json = (status, data) => ({
  statusCode: status,
  headers: { ...baseHeaders, "content-type": "application/json" },
  body: JSON.stringify(data),
});

/** A file answer. API Gateway wants binary data as base64 text. */
export const bytes = (buffer) => ({
  statusCode: 200,
  headers: { ...baseHeaders, "content-type": "application/octet-stream" },
  isBase64Encoded: true,
  body: Buffer.from(buffer).toString("base64"),
});

/** Read the request body as a JSON object. */
export function readJson(event) {
  const raw = event.body;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new HttpError(400, "Request body required");
  }

  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "Paste is too large");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "Body must be a JSON object");
  }
  return data;
}

/** Read the request body as raw file bytes. */
export function readBytes(event, maxBytes) {
  if (typeof event.body !== "string" || event.body.length === 0) {
    throw new HttpError(400, "File body required");
  }
  // API Gateway only marks a body as base64 when the content type is binary.
  if (!event.isBase64Encoded) {
    throw new HttpError(415, "Send the file as application/octet-stream");
  }
  // Check the size BEFORE decoding, so a huge body never gets allocated.
  if (Math.ceil((event.body.length * 3) / 4) > maxBytes + 3) {
    throw new HttpError(413, "File is too large");
  }
  return Buffer.from(event.body, "base64");
}
