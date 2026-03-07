import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { GigaiConfig, McpToolConfig } from "@gigai/shared";
import { McpPool } from "./pool.js";
import { McpLifecycleManager } from "./lifecycle.js";

declare module "fastify" {
  interface FastifyInstance {
    mcpPool: McpPool;
  }
}

export const mcpPlugin = fp(async (server: FastifyInstance, opts: { config: GigaiConfig }) => {
  const pool = new McpPool();

  const mcpTools = opts.config.tools.filter(
    (t): t is McpToolConfig => t.type === "mcp",
  );

  pool.loadFromConfig(mcpTools);
  server.decorate("mcpPool", pool);

  const lifecycle = new McpLifecycleManager(pool);
  lifecycle.startHealthChecks();

  server.log.info(`MCP pool initialized with ${mcpTools.length} servers`);

  server.addHook("onClose", async () => {
    await lifecycle.shutdown();
  });
}, { name: "mcp" });
