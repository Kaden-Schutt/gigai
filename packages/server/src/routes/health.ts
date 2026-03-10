import type { FastifyInstance } from "fastify";
import { platform, hostname, userInfo } from "node:os";

export const VERSION = "0.5.8";
const startTime = Date.now();

export async function healthRoutes(server: FastifyInstance) {
  server.get("/health", {
    config: { skipAuth: true },
  }, async () => {
    return {
      status: "ok" as const,
      version: VERSION,
      uptime: Date.now() - startTime,
      platform: platform(),
      hostname: hostname(),
      homeDir: userInfo().homedir,
    };
  });
}
