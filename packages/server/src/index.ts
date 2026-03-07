import { parseArgs } from "node:util";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";
import { enableFunnel, disableFunnel } from "./https/tailscale.js";
import { runTunnel } from "./https/cloudflare.js";
import type { ChildProcess } from "node:child_process";

export { createServer, type ServerOptions } from "./server.js";
export { loadConfig } from "./config.js";
export { runInit } from "./commands/init.js";
export {
  wrapCli,
  wrapMcp,
  wrapScript,
  wrapImport,
  unwrapTool,
  generateServerPairingCode,
} from "./commands/wrap.js";
export { installDaemon, uninstallDaemon } from "./commands/daemon.js";

export async function startServer() {
  const { values } = parseArgs({
    options: {
      config: { type: "string", short: "c" },
      dev: { type: "boolean", default: false },
    },
    strict: false,
  });

  const config = await loadConfig(values.config as string | undefined);
  const server = await createServer({ config, dev: values.dev as boolean });

  const port = config.server.port;
  const host = config.server.host;

  await server.listen({ port, host });
  server.log.info(`gigai server listening on ${host}:${port}`);

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
