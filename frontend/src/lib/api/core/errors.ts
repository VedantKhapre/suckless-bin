/*
This module defines the API error type and converts errors into user-readable text.
*/

export type ApiErrorKind =
  | "not_found" // 404
  | "gone" // 410 (burned or expired)
  | "invalid" // 400 (invalid request body)
  | "unauthorized" // 401 (wrong password or auth key)
  | "forbidden" // 403 (verification failed)
  | "too_large" // 413 / upload is too large
  | "rate_limited" // 429
  | "server" // 5xx
  | "timeout" // request exceeded its time budget
  | "network" // offline, DNS, CORS, connection reset
  | "unknown";

// kindFromStatus(status) maps an HTTP status code to ApiErrorKind.
const kindFromStatus = (status: number): ApiErrorKind => {
  if (status === 404) return "not_found";
  if (status === 410) return "gone";
  if (status === 400) return "invalid";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unknown";
};

// ApiError extends the built-in Error.
// It has these properties: name, kind, status, and message.
// It is used to represent errors that occur during API requests.
export default class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }

  // This function creates an ApiError from an HTTP status code.
  // If the server supplies no message, the function uses Request failed (<status>).
  static fromStatus(status: number, message?: string) {
    return new ApiError(
      kindFromStatus(status),
      message || `Request failed (${status})`,
      status,
    );
  }

  // isMissing returns true for not_found and gone.
  get isMissing() {
    return this.kind === "not_found" || this.kind === "gone";
  }
}

// This function is a type guard. It returns true when the value is an ApiError.
export const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError;

// returns text for the user.
export function describeError(error: unknown): string {
  if (!isApiError(error)) return "Something went wrong";
  switch (error.kind) {
    case "not_found":
      return "This paste does not exist";
    case "gone":
      return "This paste has expired or was burned";
    case "unauthorized":
      return "Wrong password";
    case "invalid":
      return error.message;
      case "forbidden":
        return "Verification failed, please try again";
    case "too_large":
      return "That upload is too large";
    case "rate_limited":
      return error.message.startsWith("Request failed")
        ? "Too many requests, try again shortly"
        : error.message;
    case "timeout":
      return "The server took too long to respond";
    case "network":
      return "Could not reach the server";
    default:
      return "Server error, try again";
  }
}
