/*
This module supplies two things:
1. The base address of the API.
2. Removes all trailing slash characters from the value.
3. The time limits for API requests.
*/
const rawBase: string = import.meta.env.PUBLIC_API_URL || "/api";

export const API_BASE = rawBase.replace(/\/+$/, "");

export const TIMEOUT_MS = {
  json: 15_000,
  bytes: 60_000,
} as const;
