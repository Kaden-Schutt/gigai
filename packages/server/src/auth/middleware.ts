import type { FastifyRequest, FastifyReply } from "fastify";
import { ErrorCode, KondError } from "@gigai/shared";
import { validateSession } from "./session.js";
import type { AuthStore } from "./store.js";

export function createAuthMiddleware(store: AuthStore) {
  return async function authMiddleware(request: FastifyRequest, _reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new KondError(ErrorCode.AUTH_REQUIRED, "Authorization header required");
    }

    const token = authHeader.slice(7);
    const session = validateSession(store, token);
    (request as any).session = session;
  };
}
