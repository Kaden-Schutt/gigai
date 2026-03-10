import { spawn } from "node:child_process";
import { KondError, ErrorCode } from "@gigai/shared";
import { canExecuteCommand, canUseSudo, validateCommandArgs, expandTilde, type SecurityTier } from "../security.js";

export interface ShellConfig {
  allowlist?: string[];
  allowSudo?: boolean;
}

const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

export async function execCommandSafe(
  command: string,
  args: string[],
  config: ShellConfig,
  tier: SecurityTier = "strict",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Sudo check (applies to all tiers)
  if (command === "sudo") {
    const sudoCheck = canUseSudo(config.allowSudo);
    if (!sudoCheck.allowed) {
      throw new KondError(ErrorCode.COMMAND_NOT_ALLOWED, sudoCheck.reason!);
    }
  }

  // Command check (tier-aware)
  const check = canExecuteCommand(tier, command, config.allowlist);
  if (!check.allowed) {
    throw new KondError(ErrorCode.COMMAND_NOT_ALLOWED, check.reason!);
  }

  // Argument check (block catastrophic patterns like rm -rf /)
  const argCheck = validateCommandArgs(tier, command, args);
  if (!argCheck.allowed) {
    throw new KondError(ErrorCode.COMMAND_NOT_ALLOWED, argCheck.reason!);
  }

  for (const arg of args) {
    if (arg.includes("\0")) {
      throw new KondError(ErrorCode.VALIDATION_ERROR, "Null byte in argument");
    }
  }

  const expandedArgs = args.map(expandTilde);

  return new Promise((resolve, reject) => {
    const child = spawn(command, expandedArgs, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalSize = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_OUTPUT_SIZE) stdoutChunks.push(chunk);
      else child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_OUTPUT_SIZE) stderrChunks.push(chunk);
      else child.kill("SIGTERM");
    });

    child.on("error", (err) => {
      reject(new KondError(ErrorCode.EXEC_FAILED, `Failed to spawn ${command}: ${err.message}`));
    });

    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: exitCode ?? 1,
      });
    });
  });
}
