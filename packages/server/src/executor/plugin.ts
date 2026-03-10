import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { executeTool, type ExecResult } from "./executor.js";
import type { RegistryEntry } from "../registry/types.js";
import type { SecurityTier } from "../security.js";

declare module "fastify" {
  interface FastifyInstance {
    executor: {
      execute: (entry: RegistryEntry, args: string[], timeout?: number, tier?: SecurityTier) => Promise<ExecResult>;
    };
  }
}

export const executorPlugin = fp(async (server: FastifyInstance) => {
  server.decorate("executor", {
    execute: executeTool,
  });
}, { name: "executor" });
