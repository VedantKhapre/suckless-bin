/*
This module is the public surface of the API layer.
Components and payload modules must import from: @/lib/api
*/

/*

//Runtime functions:
createPaste
fetchPaste
unlockPaste
uploadFile
fetchFileBytes
getPaste
setPaste
watchPaste
getAuthKey
setAuthKey
clearAuthKey
getSlug
isValidSlug
pasteUrl
SLUG_PATTERN
ApiError
isApiError
describeError

// Types:
ApiErrorKind
CreatePasteRequest
CreatePasteResponse
CreatePrivatePasteRequest
CreatePublicPasteRequest
FileMeta
PasteMeta
UnlockResponse
Visibility

The index does not export internal helpers such as request, requestBytes, or sendBytes.
This keeps the transport layer private.
*/
export { createPaste, fetchPaste, unlockPaste } from "./paste/endpoints";
export { uploadFile, fetchFileBytes } from "./files/endpoints";
export { getPaste, setPaste, watchPaste } from "./paste/store";
export { getAuthKey, setAuthKey, clearAuthKey } from "./paste/session";
export { getSlug, isValidSlug, pasteUrl, SLUG_PATTERN } from "./paste/slug";
export { default as ApiError, isApiError, describeError } from "./core/errors";
export type { ApiErrorKind } from "./core/errors";
export type {
  CreatePasteRequest,
  CreatePasteResponse,
  CreatePrivatePasteRequest,
  CreatePublicPasteRequest,
  FileMeta,
  PasteMeta,
  UnlockResponse,
  Visibility,
} from "./paste/types";
