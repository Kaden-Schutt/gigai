import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { GigaiConfig } from "@gigai/shared";
import { AuthStore } from "./store.js";
import { createAuthMiddleware } from "./middleware.js";
import { registerAuthRoutes } from "./routes.js";

declare module "fastify" {
  interface FastifyInstance {
    authStore: AuthStore;
  }
  interface FastifyRequest {
    session?: { id: string; orgUuid: string; token: string; expiresAt: number; lastActivity: number };
  }
}

export const authPlugin = fp(async (server: FastifyInstance, opts: { config: GigaiConfig }) => {
  const store = new AuthStore();
  const authMiddleware = createAuthMiddleware(store);

  server.decorate("authStore", store);

  // Add auth middleware to all routes except those marked with skipAuth
  server.addHook("onRequest", async (request, reply) => {
    const routeConfig = (request.routeOptions?.config as any) ?? {};
    if (routeConfig.skipAuth) return;

    // Skip auth for health endpoint
    if (request.url === "/health") return;

    // Skip auth for auth endpoints
    if (request.url.startsWith("/auth/")) return;

    await authMiddleware(request, reply);
  });

  registerAuthRoutes(server, store, opts.config);

  server.addHook("onClose", async () => {
    store.destroy();
  });
}, { name: "auth" });
