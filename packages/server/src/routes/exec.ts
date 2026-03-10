import type { FastifyInstance } from "fastify";
import type { ExecRequest, ExecMcpRequest } from "@gigai/shared";
import { GigaiError, ErrorCode } from "@gigai/shared";
import {
  readFileSafe, listDirSafe, searchFilesSafe,
  readBuiltin, writeBuiltin, editBuiltin,
  globBuiltin, grepBuiltin,
} from "../builtins/filesystem.js";
import { execCommandSafe } from "../builtins/shell.js";
import { getEffectiveTier, type SecurityTier } from "../security.js";

export async function execRoutes(server: FastifyInstance) {
  server.post<{ Body: ExecRequest }>("/exec", {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
    schema: {
      body: {
        type: "object",
        required: ["tool", "args"],
        properties: {
          tool: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          timeout: { type: "number" },
        },
      },
    },
  }, async (request) => {
    const { tool, args, timeout } = request.body;
    const entry = server.registry.get(tool);
    const tier = getEffectiveTier(server.securityConfig, tool);

    // Handle builtins
    if (entry.type === "builtin") {
      return handleBuiltin(entry.config, args, tier);
    }

    // Execute CLI/script tools
    const result = await server.executor.execute(entry, args, timeout, tier);
    return result;
  });

  server.post<{ Body: ExecMcpRequest }>("/exec/mcp", {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
    schema: {
      body: {
        type: "object",
        required: ["tool", "mcpTool", "args"],
        properties: {
          tool: { type: "string" },
          mcpTool: { type: "string" },
          args: { type: "object" },
        },
      },
    },
  }, async (request) => {
    const { tool, mcpTool, args } = request.body;
    const entry = server.registry.get(tool);

    if (entry.type !== "mcp") {
      throw new GigaiError(ErrorCode.VALIDATION_ERROR, `Tool ${tool} is not an MCP tool`);
    }

    const start = Date.now();
    const client = server.mcpPool.getClient(tool);
    const result = await client.callTool(mcpTool, args);

    return {
      content: result.content,
      isError: result.isError,
      durationMs: Date.now() - start,
    };
  });
}

async function handleBuiltin(
  config: { builtin: string; config?: Record<string, unknown> },
  args: string[],
  tier: SecurityTier,
) {
  const builtinConfig = config.config ?? {};

  switch (config.builtin) {
    // Legacy combined filesystem tool
    case "filesystem": {
      const allowedPaths = builtinConfig.allowedPaths as string[] | undefined;
      const subcommand = args[0];
      const target = args[1] ?? ".";

      switch (subcommand) {
        case "read":
          return { stdout: await readFileSafe(target, allowedPaths ?? [], tier), stderr: "", exitCode: 0, durationMs: 0 };
        case "list":
          return { stdout: JSON.stringify(await listDirSafe(target, allowedPaths ?? [], tier), null, 2), stderr: "", exitCode: 0, durationMs: 0 };
        case "search":
          return { stdout: JSON.stringify(await searchFilesSafe(target, args[2] ?? ".*", allowedPaths ?? [], tier), null, 2), stderr: "", exitCode: 0, durationMs: 0 };
        default:
          throw new GigaiError(ErrorCode.VALIDATION_ERROR, `Unknown filesystem subcommand: ${subcommand}. Use: read, list, search`);
      }
    }

    // Legacy shell tool
    case "shell": {
      const allowlist = builtinConfig.allowlist as string[] | undefined;
      const allowSudo = builtinConfig.allowSudo as boolean | undefined;
      const command = args[0];
      if (!command) {
        throw new GigaiError(ErrorCode.VALIDATION_ERROR, "No command specified");
      }
      const result = await execCommandSafe(command, args.slice(1), { allowlist, allowSudo }, tier);
      return { ...result, durationMs: 0 };
    }

    // --- New builtins ---

    case "read": {
      const allowedPaths = builtinConfig.allowedPaths as string[] | undefined;
      return { ...await readBuiltin(args, allowedPaths ?? [], tier), durationMs: 0 };
    }

    case "write": {
      const allowedPaths = builtinConfig.allowedPaths as string[] | undefined;
      return { ...await writeBuiltin(args, allowedPaths ?? [], tier), durationMs: 0 };
    }

    case "edit": {
      const allowedPaths = builtinConfig.allowedPaths as string[] | undefined;
      return { ...await editBuiltin(args, allowedPaths ?? [], tier), durationMs: 0 };
    }

    case "glob": {
      const allowedPaths = builtinConfig.allowedPaths as string[] | undefined;
      return { ...await globBuiltin(args, allowedPaths ?? [], tier), durationMs: 0 };
    }

    case "grep": {
      const allowedPaths = builtinConfig.allowedPaths as string[] | undefined;
      return { ...await grepBuiltin(args, allowedPaths ?? [], tier), durationMs: 0 };
    }

    case "bash": {
      const allowlist = builtinConfig.allowlist as string[] | undefined;
      const allowSudo = builtinConfig.allowSudo as boolean | undefined;
      const command = args[0];
      if (!command) {
        throw new GigaiError(ErrorCode.VALIDATION_ERROR, "No command specified");
      }
      const result = await execCommandSafe(command, args.slice(1), { allowlist, allowSudo }, tier);
      return { ...result, durationMs: 0 };
    }

    default:
      throw new GigaiError(ErrorCode.VALIDATION_ERROR, `Unknown builtin: ${config.builtin}`);
  }
}
