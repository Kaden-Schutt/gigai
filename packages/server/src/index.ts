import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { createServer } from "./server.js";
import { loadConfig, getDefaultConfigPath } from "./config.js";
import { enableFunnel, disableFunnel } from "./https/tailscale.js";
import { runTunnel } from "./https/cloudflare.js";
import type { ChildProcess } from "node:child_process";

export { createServer, type ServerOptions } from "./server.js";
export { loadConfig, getKondDir, getDefaultConfigPath } from "./config.js";
export { runInit } from "./commands/init.js";
export {
  wrapCli,
  wrapMcp,
  wrapScript,
  wrapImport,
  unwrapTool,
  mcpAdd,
  mcpList,
  generateServerPairingCode,
} from "./commands/wrap.js";
export { installDaemon, uninstallDaemon } from "./commands/daemon.js";
export { CronScheduler, parseAtExpression, type CronJob } from "./cron/scheduler.js";

export async function stopServer() {
  const { execFileSync } = await import("node:child_process");

  // Find kond server processes
  let pids: number[] = [];
  try {
    const out = execFileSync("pgrep", ["-f", "kond start"], { encoding: "utf8" });
    pids = out.trim().split("\n").map(Number).filter(pid => pid && pid !== process.pid);
  } catch {
    // pgrep returns non-zero if no matches
  }

  if (pids.length === 0) {
    console.log("No running kond server found.");
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Stopped kond server (PID ${pid})`);
    } catch (e) {
      console.error(`Failed to stop PID ${pid}: ${(e as Error).message}`);
    }
  }
}

export async function startServer() {
  const { values } = parseArgs({
    options: {
      config: { type: "string", short: "c" },
      dev: { type: "boolean", default: false },
    },
    strict: false,
  });

  const configFile = values.config as string | undefined;
  const config = await loadConfig(configFile);
  const configPath = resolve(configFile ?? getDefaultConfigPath());
  const server = await createServer({ config, configPath, dev: values.dev as boolean });

  const port = config.server.port;
  const host = config.server.host;

  await server.listen({ port, host });
  server.log.info(`kond server listening on ${host}:${port}`);

  // Enable HTTPS provider
  let cfTunnel: ChildProcess | undefined;
  const httpsProvider = config.server.https?.provider;

  if (httpsProvider === "tailscale") {
    try {
      const funnelUrl = await enableFunnel(port);
      server.log.info(`Tailscale Funnel enabled: ${funnelUrl}`);
    } catch (e) {
      server.log.error(`Failed to enable Tailscale Funnel: ${(e as Error).message}`);
    }
  } else if (httpsProvider === "cloudflare") {
    try {
      const tunnelName = (config.server.https as any).tunnelName;
      cfTunnel = runTunnel(tunnelName, port);
      server.log.info(`Cloudflare Tunnel started: ${tunnelName}`);
    } catch (e) {
      server.log.error(`Failed to start Cloudflare Tunnel: ${(e as Error).message}`);
    }
  }

  const shutdown = async () => {
    server.log.info("Shutting down...");
    if (httpsProvider === "tailscale") {
      try { await disableFunnel(port); } catch {}
    }
    if (cfTunnel) {
      try { cfTunnel.kill(); } catch {}
    }
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
