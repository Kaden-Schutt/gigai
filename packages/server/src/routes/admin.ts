import type { FastifyInstance } from "fastify";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { platform, homedir } from "node:os";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { VERSION } from "./health.js";

const execFileAsync = promisify(execFile);

const GH_RELEASES_URL = "https://api.github.com/repos/Kaden-Schutt/kon/releases/latest";

/** Resolve the kond binary path from PATH */
function resolveKondBin(): string {
  try {
    return execFileSync("which", ["kond"], { encoding: "utf8" }).trim();
  } catch {
    return "/usr/local/bin/kond";
  }
}

/** Check if running under a service manager that will auto-restart */
async function isManagedService(): Promise<boolean> {
  if (platform() === "darwin") {
    try {
      await access(join(homedir(), "Library", "LaunchAgents", "dev.schutt.kond.plist"));
      return true;
    } catch {
      return false;
    }
  }
  if (platform() === "linux") {
    return !!process.env.INVOCATION_ID;
  }
  return false;
}

/** Get latest release version from GitHub (no auth required) */
async function getLatestReleaseVersion(): Promise<string | null> {
  try {
    const res = await fetch(GH_RELEASES_URL, {
      headers: { "Accept": "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { tag_name?: string };
    // tag_name is "v0.5.8" → "0.5.8"
    return data.tag_name?.replace(/^v/, "") ?? null;
  } catch {
    return null;
  }
}

export async function adminRoutes(server: FastifyInstance) {
  server.post("/admin/update", async (_request, reply) => {
    // Check GitHub for latest version before doing anything
    const latestVersion = await getLatestReleaseVersion();
    if (!latestVersion || latestVersion === VERSION) {
      server.log.info(`Already up to date (current: ${VERSION}, latest: ${latestVersion})`);
      return { updated: false };
    }

    server.log.info(`Update available: ${VERSION} → ${latestVersion}`);

    // Update via install script (same as curl -fsSL kond.schutt.dev | sh)
    try {
      const { stdout, stderr } = await execFileAsync(
        "sh",
        ["-c", "curl -fsSL kond.schutt.dev | sh"],
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

      // Close current server (releases port)
      await server.close();

      const managed = await isManagedService();
      if (managed) {
        // launchd KeepAlive / systemd Restart=always will restart us
        process.exit(0);
      }

      // Manual start: spawn the updated binary
      const args = ["start", "--foreground"];
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

      const bin = resolveKondBin();
      const child = spawn(bin, args, {
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
