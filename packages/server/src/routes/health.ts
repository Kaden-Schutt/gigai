import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { platform, hostname, userInfo } from "node:os";

const startTime = Date.now();

// Capture version once at startup — not on every request
let startupVersion = "0.0.0";
try {
  const pkg = JSON.parse(
    readFileSync(resolve(import.meta.dirname ?? ".", "../package.json"), "utf8"),
  );
  startupVersion = pkg.version;
} catch {
  // Use default
}

export async function healthRoutes(server: FastifyInstance) {
  server.get("/health", {
    config: { skipAuth: true },
  }, async () => {
    return {
      status: "ok" as const,
      version: startupVersion,
      uptime: Date.now() - startTime,
      platform: platform(),
      hostname: hostname(),
      homeDir: userInfo().homedir,
    };
  });
}
