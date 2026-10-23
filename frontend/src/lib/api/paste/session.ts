/*
This module stores auth keys for unlocked private pastes.
The module uses one in-memory Map it does not use localStorage or sessionStorage, also does not set expiry time.
*/

// The map key is the slug. The map value is the raw auth key.
const authKeys = new Map<string, ArrayBuffer>();

export const getAuthKey = (slug: string) => authKeys.get(slug);
export const setAuthKey = (slug: string, key: ArrayBuffer) =>
  void authKeys.set(slug, key);

// The map is per tab. Other tabs have separate maps and separate keys.
// clearAuthKey is available, but no current UI action calls it.
// Planning to call clearAuthKey in the future when a lock, logout, or "forget paste" action occurs.
export const clearAuthKey = (slug: string) => void authKeys.delete(slug);
