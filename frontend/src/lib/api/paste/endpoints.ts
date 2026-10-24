/*
This module defines the paste create, read, and unlock endpoints.
*/

import { request } from "../core/http";
import type {
  CreatePasteRequest,
  CreatePasteResponse,
  PasteMeta,
  UnlockResponse,
} from "./types";

const pastePath = (slug: string) => `/paste/${encodeURIComponent(slug)}`;

// createPaste sends a create paste request to the server.
// It returns { slug: string }
// The request body is a CreatePasteRequest. This is a union of public and private request types.
export const createPaste = (body: CreatePasteRequest, turnstileToken: string) =>
  request<CreatePasteResponse>("/paste", {
    method: "POST",
    json: { ...body, turnstileToken },
  });

// fetchPaste sends GET /paste/:slug.
// It accepts an optional AbortSignal.
// It returns PasteMeta.
// fetchPaste accepts a signal, but store.ts does not pass one.
// A fetch continues after a component unmounts unless the caller supplies a signal.
export const fetchPaste = (slug: string, signal?: AbortSignal) =>
  request<PasteMeta>(pastePath(slug), { signal });

// The server returns only the locked subset for a private paste.
// It sends { "authKey": "<base64 auth key>" }
export const unlockPaste = (slug: string, authKey: string) =>
  request<UnlockResponse>(`${pastePath(slug)}/unlock`, {
    method: "POST",
    json: { authKey },
  });
