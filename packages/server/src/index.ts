import { parseArgs } from "node:util";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";

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

  const shutdown = async () => {
    server.log.info("Shutting down...");
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
