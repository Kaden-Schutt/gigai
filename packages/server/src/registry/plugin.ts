import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { KondConfig } from "@gigai/shared";
import { ToolRegistry } from "./registry.js";

declare module "fastify" {
  interface FastifyInstance {
    registry: ToolRegistry;
  }
}

export const registryPlugin = fp(async (server: FastifyInstance, opts: { config: KondConfig }) => {
  const registry = new ToolRegistry();
  registry.loadFromConfig(opts.config.tools);
  server.decorate("registry", registry);
  server.log.info(`Loaded ${registry.list().length} tools`);
}, { name: "registry" });
