import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config.mjs";
import { s3 } from "./clients.mjs";

// Files live at pastes/<link>/<file number>
const keyFor = (slug, index) => `pastes/${slug}/${index}`;

/** Save a file. Returns false if that slot already has one (a file is never overwritten). */
export async function saveFile(slug, index, body) {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.filesBucket,
        Key: keyFor(slug, index),
        Body: body,
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
        IfNoneMatch: "*", // "only if nothing is there yet"
      }),
    );
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (error?.name === "PreconditionFailed" || status === 412 || status === 409) return false;
    throw error;
  }
}

/** Read a file's bytes, or null if it is not there. (Needs s3:ListBucket, else S3 answers 403.) */
export async function readFile(slug, index) {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: env.filesBucket, Key: keyFor(slug, index) }),
    );
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (error) {
    if (error?.name === "NoSuchKey") return null;
    throw error;
  }
}
