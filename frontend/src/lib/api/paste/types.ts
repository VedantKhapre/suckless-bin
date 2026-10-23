/*
This module defines the data shapes that cross the network.
It has no run-time code. All exports are types.
salt, iv, authKey, and ciphertext are base64 strings on the wire. >,<
*/
export type Visibility = "public" | "private";

export type FileMeta = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

/*
What GET /paste/:slug returns (private pastes return only the locked subset).
*/
export type PasteMeta = {
  visibility: Visibility;
  title: string;
  expiresAt: number;
  language?: string;
  totalChars?: number;
  filesMeta?: FileMeta[];
  // Plaintext (public) or decrypted text (private, after unlock).
  text?: string;
  // Private only: base64 KDF salt and AES-GCM IV.
  salt?: string;
  iv?: string;
};

// This is an internal base type. It is not exported.
type CreateBase = {
  title: string;
  expiration: string;
  language: string;
  totalChars: number;
  filesMeta: FileMeta[];
};

// The public request contains plaintext.
export type CreatePublicPasteRequest = CreateBase & {
  visibility: "public";
  text: string;
};

// The private request contains encrypted text and the auth key.
export type CreatePrivatePasteRequest = CreateBase & {
  visibility: "private";
  salt: string;
  iv: string;
  authKey: string;
  ciphertext: string;
};

export type CreatePasteRequest =
  | CreatePublicPasteRequest
  | CreatePrivatePasteRequest;

export type CreatePasteResponse = { slug: string };

export type UnlockRequest = { authKey: string };

// The unlock response does not contain title, visibility, or expiresAt.
// The caller merges these values from PasteMeta.
export type UnlockResponse = {
  ciphertext: string;
  language: string;
  totalChars: number;
  filesMeta: FileMeta[];
};
