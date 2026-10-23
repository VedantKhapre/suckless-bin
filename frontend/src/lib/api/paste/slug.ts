/*
This module reads the slug from the current URL and builds paste URLs.
*/

// A valid slug has no slash, dot, space, or other character.
// A valid slug has:
// - 6 to 10 characters.
// - Uppercase letters.
// - Lowercase letters.
export const SLUG_PATTERN = /^[A-Za-z]{6,10}$/;

export const isValidSlug = (value: string): boolean =>
  SLUG_PATTERN.test(value);

// The function uses this order:
// 1. Read the s query parameter.
// 2. If the query value is valid, return it.
// 3. Read the last non-empty path segment.
// 4. If the path value is valid, return it.
// 5. Return an empty string.
export function getSlug(): string {
  const fromQuery = new URLSearchParams(location.search).get("s");
  if (fromQuery && isValidSlug(fromQuery)) return fromQuery;

  const last = location.pathname.split("/").filter(Boolean).pop() ?? "";
  return isValidSlug(last) ? last : "";
}

export const pasteUrl = (slug: string) => `${location.origin}/${slug}`;
