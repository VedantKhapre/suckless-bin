/*
This module sends HTTP requests.
It adds the API base address, headers, JSON encoding, timeouts, and error conversion.
The json option has priority over body. If a caller supplies both, the module sends the JSON value. Do not supply both.

requestBytes does not check the response content type.
A JSON error response can become bytes if the server returns a non-OK status that send does not catch.
Send catches non-OK statuses first.

sendBytes uses application/octet-stream. API Gateway can encode binary bodies as base64. The Lambda handler must decode the body correctly.
sendBytes ignores the response body. A successful upload can still contain a response body. The module does not read it.
*/

import { API_BASE, TIMEOUT_MS } from "./config";
import ApiError from "./errors";

type Options = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit;
  timeoutMs?: number;
};

// Combines the caller signal with a timeout signal.
// 1. It creates AbortSignal.timeout(ms).
// 2. If the caller supplied a signal, it combines both signals with AbortSignal.any.
// 3. If the caller supplied no signal, it uses only the timeout signal.
function withTimeout(signal: AbortSignal | null | undefined, ms: number) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Sends an HTTP request with the given path and options.
async function send(path: string, opts: Options, defaultTimeout: number) {
  // Separates json, timeoutMs, signal, and headers from the other request options.
  const { json, timeoutMs = defaultTimeout, signal, headers, ...init } = opts;
  const finalHeaders = new Headers(headers);

  // If json is not undefined
  // - Set content-type to application/json.
  // - Set body to JSON.stringify(json).
  let body = init.body;
  if (json !== undefined) {
    finalHeaders.set("content-type", "application/json");
    body = JSON.stringify(json);
  }

  // Sends the request using fetch, applying the final headers and body.
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      body,
      headers: finalHeaders,
      signal: withTimeout(signal, timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError("timeout", "Request timed out");
    }
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("network", "Network error");
  }

  if (!res.ok) throw ApiError.fromStatus(res.status, await readErrorMessage(res));
  return res;
}

// Reads the error message from the error response.
async function readErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : undefined;
  } catch {
    return undefined;
  }
}

// Calls send with the JSON timeout, if the status is 204, it returns undefined
// otherwise, it calls res.json() and casts the result to T.
// The cast is a compile-time operation only.
// The module does not validate the response at run time.
export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const res = await send(path, opts, TIMEOUT_MS.json);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// requestBytes sends a request and reads the response as an ArrayBuffer.
// It uses the binary timeout and is used for file downloads.
export async function requestBytes(
  path: string,
  opts: Options = {},
): Promise<ArrayBuffer> {
  const res = await send(path, opts, TIMEOUT_MS.bytes);
  return res.arrayBuffer();
}

// sendBytes sends a request with a binary body.
// It also uses the binary timeout and is used for file uploads.
export async function sendBytes(
  path: string,
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
  opts: Options = {},
): Promise<void> {
  await send(
    path,
    {
      method: "PUT",
      // API Gateway only treats the body as binary for non-text content types.
      headers: { "content-type": "application/octet-stream" },
      ...opts,
      body: bytes as BodyInit,
    },
    TIMEOUT_MS.bytes,
  );
}
