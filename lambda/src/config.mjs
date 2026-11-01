/**
 * Every setting in one place.
 *
 * Part 1 - values Terraform gives the function (environment variables).
 * Part 2 - limits you can tune. Where a limit also exists in the frontend, it says so.
 */

// ---------------------------------------------------------------------------
// Part 1: environment variables (set in terraform, Lambda "environment" block)
// ---------------------------------------------------------------------------

// Read lazily, so a missing variable fails one request with a clear message
// instead of breaking the whole function when it starts.
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  /** DynamoDB table. Holds pastes AND the small counters used for rate limits. */
  get tableName() {
    return required("TABLE_NAME");
  },
  /** Private S3 bucket for uploaded files. */
  get filesBucket() {
    return required("FILES_BUCKET");
  },
  /** A secret mixed into every hash we store (passwords and IP addresses). */
  get pepper() {
    return required("AUTH_PEPPER");
  },
  /** Cloudflare Turnstile secret key. */
  get turnstileSecret() {
    return required("TURNSTILE_SECRET_KEY");
  },
};

// ---------------------------------------------------------------------------
// Part 2: limits
// ---------------------------------------------------------------------------

/** Biggest request body we accept. DynamoDB items max out at 400 KB, so this leaves room. */
export const MAX_REQUEST_BYTES = 360_000;

/** Files per paste. Matches the upload limit in the frontend. */
export const MAX_FILES = 5;

/**
 * Biggest single file. Lambda can only handle 6 MB per request and API Gateway adds a
 * third on top for binary data, so 4 MiB is the safe maximum. Matches the frontend.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Allowed expiry choices -> minutes. Must match the options in Expiry.astro. */
export const EXPIRY_MINUTES = {
  "20m": 20,
  "40m": 40,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "8h": 480,
};

/** Sizes of the crypto values the browser sends. Must match src/lib/crypto in the frontend. */
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const AUTH_KEY_BYTES = 32;

/** DynamoDB deletes expired items late (up to 48h), so every read also checks the expiry itself. */
export const TTL_GRACE_SECONDS = 3600;

/** Pastes one network may create per UTC day. Override with the DAILY_PASTE_LIMIT variable. */
export const dailyPasteLimit = () => {
  const n = Number(process.env.DAILY_PASTE_LIMIT ?? 5);
  return Number.isInteger(n) && n > 0 ? n : 5;
};

/**
 * Wrong-password budget: how many attempts one network gets per paste in each window.
 * Only that network is paused. Override with the UNLOCK_MAX_ATTEMPTS variable.
 */
export const UNLOCK_WINDOW_MS = 15 * 60_000;
export const unlockMaxAttempts = () => {
  const n = Number(process.env.UNLOCK_MAX_ATTEMPTS ?? 10);
  return Number.isInteger(n) && n > 0 ? n : 10;
};
