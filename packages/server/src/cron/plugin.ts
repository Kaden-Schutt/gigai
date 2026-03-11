import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { KondConfig } from "@gigai/shared";
import { CronScheduler } from "./scheduler.js";
import { dirname } from "node:path";

declare module "fastify" {
  interface FastifyInstance {
    scheduler: CronScheduler;
  }
}

export const cronPlugin = fp(async (server: FastifyInstance, opts: { configPath: string }) => {
  const configDir = dirname(opts.configPath);

  // Build an executor that routes through the same logic as /exec
  const executor = async (tool: string, args: string[]): Promise<void> => {
    const entry = server.registry.get(tool);

    if (entry.type === "builtin") {
      // For builtins we just call the executor indirectly —
      // but builtins are handled specially in exec route.
      // We replicate the pattern here for simplicity.
      const { execCommandSafe } = await import("../builtins/shell.js");
      const {
        readBuiltin, writeBuiltin, editBuiltin,
        globBuiltin, grepBuiltin,
      } = await import("../builtins/filesystem.js");

      const builtinConfig = (entry.config as any).config ?? {};

      switch ((entry.config as any).builtin) {
        case "bash": {
          const allowlist = (builtinConfig.allowlist as string[]) ?? [];
          const allowSudo = (builtinConfig.allowSudo as boolean) ?? false;
          const cmd = args[0];
          if (cmd) await execCommandSafe(cmd, args.slice(1), { allowlist, allowSudo });
          break;
        }
        case "read": {
          const allowedPaths = (builtinConfig.allowedPaths as string[]) ?? ["."];
          await readBuiltin(args, allowedPaths);
          break;
        }
        case "write": {
          const allowedPaths = (builtinConfig.allowedPaths as string[]) ?? ["."];
          await writeBuiltin(args, allowedPaths);
          break;
        }
        case "edit": {
          const allowedPaths = (builtinConfig.allowedPaths as string[]) ?? ["."];
          await editBuiltin(args, allowedPaths);
          break;
        }
        case "glob": {
          const allowedPaths = (builtinConfig.allowedPaths as string[]) ?? ["."];
          await globBuiltin(args, allowedPaths);
          break;
        }
        case "grep": {
          const allowedPaths = (builtinConfig.allowedPaths as string[]) ?? ["."];
          await grepBuiltin(args, allowedPaths);
          break;
        }
      }
      return;
    }

    if (entry.type === "mcp") {
      // MCP tools require mcpTool argument; for cron we just call the first arg as mcpTool
      const client = server.mcpPool.getClient(tool);
      await client.callTool(args[0] ?? tool, {});
      return;
    }

    // CLI / script tools
    await server.executor.execute(entry, args);
  };

  const scheduler = new CronScheduler(configDir, executor, server.log);
  await scheduler.load();
  scheduler.start();

  server.decorate("scheduler", scheduler);

  server.addHook("onClose", async () => {
    scheduler.stop();
  });
}, { name: "cron", dependencies: ["registry", "executor"] });
