import { nanoid } from "nanoid";

export interface PairingCode {
  code: string;
  expiresAt: number;
  used: boolean;
}

export interface Session {
  id: string;
  orgUuid: string;
  token: string;
  expiresAt: number;
  lastActivity: number;
}

export class AuthStore {
  private pairingCodes = new Map<string, PairingCode>();
  private sessions = new Map<string, Session>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  // Pairing codes
  addPairingCode(code: string, ttlSeconds: number): PairingCode {
    const entry: PairingCode = {
      code,
      expiresAt: Date.now() + ttlSeconds * 1000,
      used: false,
    };
    this.pairingCodes.set(code, entry);
    return entry;
  }

  getPairingCode(code: string): PairingCode | undefined {
    return this.pairingCodes.get(code);
  }

  markPairingCodeUsed(code: string): void {
    const entry = this.pairingCodes.get(code);
    if (entry) {
      entry.used = true;
    }
  }

  // Sessions
  createSession(orgUuid: string, ttlSeconds: number): Session {
    const session: Session = {
      id: nanoid(32),
      orgUuid,
      token: nanoid(48),
      expiresAt: Date.now() + ttlSeconds * 1000,
      lastActivity: Date.now(),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  getSession(token: string): Session | undefined {
    const session = this.sessions.get(token);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  // Cleanup
  private cleanup(): void {
    const now = Date.now();
    for (const [key, code] of this.pairingCodes) {
      if (code.expiresAt < now) {
        this.pairingCodes.delete(key);
      }
    }
    for (const [key, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.pairingCodes.clear();
    this.sessions.clear();
  }
}
