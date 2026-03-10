import { decrypt, ErrorCode, KondError, type EncryptedPayload } from "@gigai/shared";
import type { AuthStore, Session } from "./store.js";

export function connectWithToken(
  store: AuthStore,
  encryptedToken: string,
  orgUuid: string,
  encryptionKey: string,
  sessionTtlSeconds: number,
): Session {
  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(encryptedToken);
  } catch {
    throw new KondError(ErrorCode.TOKEN_INVALID, "Invalid token format");
  }

  let decrypted;
  try {
    decrypted = decrypt(payload, encryptionKey);
  } catch {
    throw new KondError(ErrorCode.TOKEN_DECRYPT_FAILED, "Failed to decrypt token");
  }

  if (decrypted.orgUuid !== orgUuid) {
    throw new KondError(ErrorCode.ORG_MISMATCH, "Organization UUID mismatch");
  }

  return store.createSession(orgUuid, sessionTtlSeconds);
}

export function validateSession(store: AuthStore, token: string): Session {
  const session = store.getSession(token);

  if (!session) {
    throw new KondError(ErrorCode.SESSION_INVALID, "Invalid session token");
  }

  if (session.expiresAt < Date.now()) {
    throw new KondError(ErrorCode.SESSION_EXPIRED, "Session expired");
  }

  return session;
}
