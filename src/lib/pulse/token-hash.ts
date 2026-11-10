import { createHash, randomBytes } from "crypto";

const TOKEN_BYTES = 32;

/** 32 random bytes. The plaintext is base64url. The stored value is SHA-256 of the raw bytes. */
export function generatePulseToken() {
  const raw = randomBytes(TOKEN_BYTES);
  return {
    token: raw.toString("base64url"),
    hashHex: createHash("sha256").update(raw).digest("hex"),
  };
}

/** Hash a presented token. Returns null when the token is the wrong shape. */
export function hashPulseToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== TOKEN_BYTES) return null;
  return createHash("sha256").update(raw).digest("hex");
}
