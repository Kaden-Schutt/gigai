import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { GigaiError, ErrorCode, type GigaiConfig, type PairRequest, type ConnectRequest } from "@gigai/shared";
import { generatePairingCode, validateAndPair } from "./pairing.js";
import { connectWithToken } from "./session.js";
import type { AuthStore } from "./store.js";

export function registerAuthRoutes(
  server: FastifyInstance,
  store: AuthStore,
  config: GigaiConfig,
) {
  const serverFingerprint = randomBytes(16).toString("hex");
  const serverName = config.serverName ?? hostname();

  server.post<{ Body: PairRequest }>("/auth/pair", {
    config: {
      rateLimit: { max: 5, timeWindow: "1 hour" },
    },
    schema: {
      body: {
        type: "object",
        required: ["pairingCode", "orgUuid"],
        properties: {
          pairingCode: { type: "string" },
          orgUuid: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const { pairingCode, orgUuid } = request.body;
    const encryptedToken = validateAndPair(
      store,
      pairingCode,
      orgUuid,
      config.auth.encryptionKey,
      serverFingerprint,
    );
    return { encryptedToken: JSON.stringify(encryptedToken), serverName };
  });

  server.post<{ Body: ConnectRequest }>("/auth/connect", {
    config: {
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
    schema: {
      body: {
        type: "object",
        required: ["encryptedToken", "orgUuid"],
        properties: {
          encryptedToken: { type: "string" },
          orgUuid: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const { encryptedToken, orgUuid } = request.body;
    const session = connectWithToken(
      store,
      encryptedToken,
      orgUuid,
      config.auth.encryptionKey,
      config.auth.sessionTtlSeconds,
    );
    return {
      sessionToken: session.token,
      expiresAt: session.expiresAt,
    };
  });

  // Internal route for server-side pairing code generation (localhost only)
  server.get("/auth/pair/generate", {
    config: { skipAuth: true },
  }, async (request) => {
    const remoteAddr = request.ip;
    if (remoteAddr !== "127.0.0.1" && remoteAddr !== "::1" && remoteAddr !== "::ffff:127.0.0.1") {
      throw new GigaiError(ErrorCode.AUTH_REQUIRED, "Pairing code generation is only available from localhost");
    }
    const code = generatePairingCode(store, config.auth.pairingTtlSeconds);
    return { code, expiresIn: config.auth.pairingTtlSeconds };
  });
}
