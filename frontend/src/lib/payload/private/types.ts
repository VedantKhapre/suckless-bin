export type PrivatePayload = {
  password: string;
  encKey: CryptoKey;
  plaintext: string;
};