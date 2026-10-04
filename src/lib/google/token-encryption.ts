import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = 1 as const;

export type SealedGoogleToken = {
  ciphertext: string;
  iv: string;
  tag: string;
  version: typeof VERSION;
};

export class GoogleTokenEncryptionUnavailableError extends Error {
  constructor() {
    super("Google token encryption is not configured.");
    this.name = "GoogleTokenEncryptionUnavailableError";
  }
}

export function getGoogleTokenEncryptionKey() {
  const encoded = process.env.GOOGLE_DATA_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new GoogleTokenEncryptionUnavailableError();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new GoogleTokenEncryptionUnavailableError();
  }
  return key;
}

export function sealGoogleToken(token: string, aad: string, key: Buffer): SealedGoogleToken {
  if (!token || !aad || key.length !== 32) throw new Error("Unable to encrypt Google credentials.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    version: VERSION,
  };
}

function decodeBase64Url(value: string) {
  const decoded = Buffer.from(value, "base64url");
  if (!value || decoded.toString("base64url") !== value) {
    throw new Error("Invalid token encoding.");
  }
  return decoded;
}

export function openGoogleToken(sealed: SealedGoogleToken, aad: string, key: Buffer) {
  if (sealed.version !== VERSION || !aad || key.length !== 32) {
    throw new Error("Unable to decrypt Google credentials.");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, decodeBase64Url(sealed.iv));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(decodeBase64Url(sealed.tag));
    return Buffer.concat([
      decipher.update(decodeBase64Url(sealed.ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt Google credentials.");
  }
}
