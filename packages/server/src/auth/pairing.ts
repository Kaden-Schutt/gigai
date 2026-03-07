import { nanoid } from "nanoid";
import { encrypt, type EncryptedPayload, ErrorCode, GigaiError } from "@gigai/shared";
import type { AuthStore } from "./store.js";

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_CHARS = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // No I, O (avoid confusion)

export function generatePairingCode(store: AuthStore, ttlSeconds: number): string {
  let code = "";
  const bytes = nanoid(PAIRING_CODE_LENGTH);
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_CHARS[bytes.charCodeAt(i) % PAIRING_CODE_CHARS.length];
  }
  store.addPairingCode(code, ttlSeconds);
  return code;
}

export function validateAndPair(
  store: AuthStore,
  code: string,
  orgUuid: string,
  encryptionKey: string,
  serverFingerprint: string,
): EncryptedPayload {
  const entry = store.getPairingCode(code.toUpperCase());

  if (!entry) {
    throw new GigaiError(ErrorCode.PAIRING_INVALID, "Invalid pairing code");
  }

  if (entry.used) {
    throw new GigaiError(ErrorCode.PAIRING_USED, "Pairing code already used");
  }

  if (entry.expiresAt < Date.now()) {
    throw new GigaiError(ErrorCode.PAIRING_EXPIRED, "Pairing code expired");
  }

  store.markPairingCodeUsed(code.toUpperCase());

  return encrypt(
    { orgUuid, serverFingerprint, createdAt: Date.now() },
    encryptionKey,
  );
}
