import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const startTime = Date.now();

export async function healthRoutes(server: FastifyInstance) {
  server.get("/health", {
    config: { skipAuth: true },
  }, async () => {
    let version = "0.1.0";
    try {
      const pkg = JSON.parse(
        await readFile(resolve(import.meta.dirname ?? ".", "../package.json"), "utf8"),
      );
      version = pkg.version;
    } catch {
      // Use default
    }
    return {
      status: "ok" as const,
      version,
      uptime: Date.now() - startTime,
    };
  });
}
