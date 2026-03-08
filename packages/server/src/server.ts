import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { GigaiError, ErrorCode, type GigaiConfig } from "@gigai/shared";
import { authPlugin } from "./auth/plugin.js";
import { registryPlugin } from "./registry/plugin.js";
import { executorPlugin } from "./executor/plugin.js";
import { mcpPlugin } from "./mcp/plugin.js";
import { healthRoutes } from "./routes/health.js";
import { toolRoutes } from "./routes/tools.js";
import { execRoutes } from "./routes/exec.js";
import { transferRoutes } from "./routes/transfer.js";
import { adminRoutes } from "./routes/admin.js";

export interface ServerOptions {
  config: GigaiConfig;
  dev?: boolean;
}

export async function createServer(opts: ServerOptions): Promise<FastifyInstance> {
  const { config, dev = false } = opts;

  const server = Fastify({
    logger: {
      level: dev ? "debug" : "info",
    },
    trustProxy: !dev, // Only trust proxy headers in production (behind HTTPS reverse proxy)
  });

  // HTTPS enforcement (skip in dev mode or when behind a tunnel that terminates TLS)
  const httpsProvider = config.server.https?.provider;
  const behindTunnel = httpsProvider === "tailscale" || httpsProvider === "cloudflare";
  if (!dev && !behindTunnel) {
    server.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
      if (request.protocol !== "https") {
        throw new GigaiError(ErrorCode.HTTPS_REQUIRED, "HTTPS is required");
      }
    });
  }

  // Register core plugins
  await server.register(cors, { origin: false });
  await server.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await server.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

  // Register application plugins
  await server.register(authPlugin, { config });
  await server.register(registryPlugin, { config });
  await server.register(executorPlugin);
  await server.register(mcpPlugin, { config });

  // Register routes
  await server.register(healthRoutes);
  await server.register(toolRoutes);
  await server.register(execRoutes);
  await server.register(transferRoutes);
  await server.register(adminRoutes);

  // Global error handler
  server.setErrorHandler((error: Error, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof GigaiError) {
      reply.status(error.statusCode).send(error.toJSON());
      return;
    }

    // Fastify rate limit errors
    if ("statusCode" in error && (error as any).statusCode === 429) {
      reply.status(429).send({
        error: { code: ErrorCode.RATE_LIMITED, message: "Too many requests" },
      });
      return;
    }

    server.log.error(error);
    reply.status(500).send({
      error: { code: ErrorCode.INTERNAL_ERROR, message: "Internal server error" },
    });
  });

  return server;
}
