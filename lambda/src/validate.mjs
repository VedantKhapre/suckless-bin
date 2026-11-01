import {
  AUTH_KEY_BYTES,
  EXPIRY_MINUTES,
  IV_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_REQUEST_BYTES,
  SALT_BYTES,
} from "./config.mjs";
import { HttpError } from "./http.mjs";

/**
 * Checks everything the browser sends us. Anything wrong -> a 400 with a plain message.
 * We rebuild every object from scratch, so unexpected extra fields are dropped.
 */

const bad = (message) => new HttpError(400, message);

/** A link is 6 to 10 letters. Same rule as the frontend and the CloudFront function. */
export const SLUG_PATTERN = /^[A-Za-z]{6,10}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function text(value, field, { min = 1, max, trim = true } = {}) {
  if (typeof value !== "string") throw bad(`${field} must be a string`);
  const out = trim ? value.trim() : value;
  if (out.length < min) throw bad(`${field} is required`);
  if (out.length > max) throw bad(`${field} is too long`);
  return out;
}

function wholeNumber(value, field, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw bad(`${field} is invalid`);
  }
  return value;
}

/** Base64 text -> bytes. Pass `exactBytes` when the value must have a fixed size. */
export function decodeBase64(value, field, exactBytes) {
  if (typeof value !== "string" || value.length === 0 || !BASE64.test(value)) {
    throw bad(`${field} must be base64`);
  }
  const buffer = Buffer.from(value, "base64");
  if (exactBytes !== undefined && buffer.length !== exactBytes) {
    throw bad(`${field} has the wrong length`);
  }
  return buffer;
}

function parseFilesMeta(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FILES) {
    throw bad(`At most ${MAX_FILES} files are allowed`);
  }
  return value.map((file, i) => {
    if (file === null || typeof file !== "object") throw bad("Invalid file entry");
    if (!Number.isFinite(file.lastModified)) throw bad(`filesMeta[${i}].lastModified is invalid`);
    return {
      name: text(file.name, `filesMeta[${i}].name`, { max: 255 }),
      // At least 1 byte: an empty file can never be uploaded.
      size: wholeNumber(file.size, `filesMeta[${i}].size`, { min: 1, max: MAX_FILE_BYTES }),
      type: text(file.type ?? "", `filesMeta[${i}].type`, { min: 0, max: 255 }),
      lastModified: file.lastModified,
    };
  });
}

/** Check the "create a paste" request and return only the fields we store. */
export function parseNewPaste(body) {
  const visibility = body.visibility;
  if (visibility !== "public" && visibility !== "private") {
    throw bad("visibility must be public or private");
  }

  const minutes = EXPIRY_MINUTES[body.expiration];
  if (!minutes) throw bad("Invalid expiration");

  const common = {
    visibility,
    title: text(body.title, "title", { max: 200 }),
    expiration: body.expiration,
    minutes,
    language: text(body.language, "language", { max: 64 }),
    filesMeta: parseFilesMeta(body.filesMeta),
  };

  if (visibility === "public") {
    const pasteText = text(body.text, "text", { max: MAX_REQUEST_BYTES, trim: false });
    if (pasteText.trim().length === 0) throw bad("text is required");
    return { ...common, text: pasteText, totalChars: pasteText.length };
  }

  // Private pastes arrive already encrypted by the browser. We only check the shapes.
  return {
    ...common,
    totalChars: wholeNumber(body.totalChars, "totalChars", { min: 0, max: MAX_REQUEST_BYTES }),
    salt: decodeBase64(body.salt, "salt", SALT_BYTES).toString("base64"),
    iv: decodeBase64(body.iv, "iv", IV_BYTES).toString("base64"),
    authKey: decodeBase64(body.authKey, "authKey", AUTH_KEY_BYTES),
    ciphertext: decodeBase64(body.ciphertext, "ciphertext").toString("base64"),
  };
}

/** The paste link from the URL. A malformed one answers "not found", same as a missing one. */
export function getSlug(event) {
  const slug = event.pathParameters?.slug;
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    throw new HttpError(404, "Paste not found");
  }
  return slug;
}

/** The file number from the URL, checked against how many files the paste has. */
export function getFileIndex(event, filesMeta) {
  const raw = event.pathParameters?.index;
  const index = /^\d{1,2}$/.test(raw ?? "") ? Number(raw) : -1;
  if (index < 0 || index >= filesMeta.length) throw bad("Invalid file index");
  return index;
}
