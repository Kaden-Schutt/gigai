export interface JWTPayload {
  [key: string]: unknown;
  organization_uuid?: string;
  sub?: string;
  exp?: number;
  iat?: number;
}

export function decodeJWTPayload(token: string): JWTPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format: expected 3 segments");
  }

  const payload = parts[1]!;
  // base64url to base64
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const decoded = Buffer.from(padded, "base64").toString("utf8");

  return JSON.parse(decoded) as JWTPayload;
}
