import type { FastifyInstance } from "fastify";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function adminRoutes(server: FastifyInstance) {
  server.post("/admin/update", async (_request, reply) => {
    // Install latest version
    try {
      const { stdout, stderr } = await execFileAsync(
        "npm",
        ["install", "-g", "@schuttdev/gigai@latest"],
        { timeout: 120_000 },
      );
      server.log.info(`Update output: ${stdout}`);
      if (stderr) server.log.warn(`Update stderr: ${stderr}`);
    } catch (e) {
      server.log.error(`Update failed: ${(e as Error).message}`);
      reply.status(500);
      return { updated: false, error: (e as Error).message };
    }

    // Schedule restart after response is sent
    setTimeout(async () => {
      server.log.info("Restarting server after update...");

      // Build restart args from current process
      const args = ["start"];
      const configIdx = process.argv.indexOf("--config");
      if (configIdx !== -1 && process.argv[configIdx + 1]) {
        args.push("--config", process.argv[configIdx + 1]);
      }
      const shortIdx = process.argv.indexOf("-c");
      if (shortIdx !== -1 && process.argv[shortIdx + 1]) {
        args.push("--config", process.argv[shortIdx + 1]);
      }
      if (process.argv.includes("--dev")) {
        args.push("--dev");
      }

      // Close current server (releases port)
      await server.close();

      // Spawn updated server
      const child = spawn("gigai", args, {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
      });
      child.unref();

      process.exit(0);
    }, 500);

    return { updated: true, restarting: true };
  });
}
