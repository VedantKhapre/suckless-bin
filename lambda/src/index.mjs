import { HttpError, json } from "./http.mjs";
import { createPaste } from "./routes/create-paste.mjs";
import { downloadPrivateFile, downloadPublicFile } from "./routes/download-file.mjs";
import { getPaste } from "./routes/get-paste.mjs";
import { unlockPaste } from "./routes/unlock-paste.mjs";
import { uploadFile } from "./routes/upload-file.mjs";

/**
 * THE ENTRY POINT. API Gateway calls `handler` for every request.
 *
 * `routes` maps "METHOD /path" to the function that answers it. The keys must match the
 * route list in terraform exactly, because API Gateway only forwards routes declared there.
 */
export const routes = {
  "POST /paste": createPaste,
  "GET /paste/{slug}": getPaste,
  "POST /paste/{slug}/unlock": unlockPaste,
  "PUT /paste/{slug}/file/{index}": uploadFile,
  "GET /paste/{slug}/file/{index}": downloadPublicFile,
  "POST /paste/{slug}/file/{index}": downloadPrivateFile,
};

export async function handler(event) {
  try {
    const route = routes[event.routeKey];
    if (!route) throw new HttpError(404, "Not found");
    return await route(event);
  } catch (error) {
    // Expected problems (bad input, wrong password, limits): the visitor sees the message.
    if (error instanceof HttpError) return json(error.status, { error: error.message });

    // Anything else is a bug or an AWS problem: log details, tell the visitor nothing.
    // Never log request bodies: they hold password proofs and encrypted text.
    console.error(
      JSON.stringify({
        message: "unhandled error",
        route: event?.routeKey,
        error: String(error?.stack ?? error),
      }),
    );
    return json(500, { error: "Internal error" });
  }
}
