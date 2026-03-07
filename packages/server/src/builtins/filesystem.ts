import { readFile as fsReadFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { realpath } from "node:fs/promises";
import { GigaiError, ErrorCode } from "@gigai/shared";

async function validatePath(targetPath: string, allowedPaths: string[]): Promise<string> {
  const resolved = resolve(targetPath);
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    // File may not exist yet, check parent
    real = resolved;
  }

  const isAllowed = allowedPaths.some((allowed) => {
    const resolvedAllowed = resolve(allowed);
    const allowedPrefix = resolvedAllowed.endsWith("/") ? resolvedAllowed : resolvedAllowed + "/";
    return real === resolvedAllowed || real.startsWith(allowedPrefix)
      || resolved === resolvedAllowed || resolved.startsWith(allowedPrefix);
  });

  if (!isAllowed) {
    throw new GigaiError(
      ErrorCode.PATH_NOT_ALLOWED,
      `Path not within allowed directories: ${targetPath}`,
    );
  }

  return resolved;
}

export async function readFileSafe(
  path: string,
  allowedPaths: string[],
): Promise<string> {
  const safePath = await validatePath(path, allowedPaths);
  return fsReadFile(safePath, "utf8");
}

export async function listDirSafe(
  path: string,
  allowedPaths: string[],
): Promise<Array<{ name: string; type: "file" | "directory" }>> {
  const safePath = await validatePath(path, allowedPaths);
  const entries = await readdir(safePath, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    type: e.isDirectory() ? "directory" as const : "file" as const,
  }));
}

export async function searchFilesSafe(
  path: string,
  pattern: string,
  allowedPaths: string[],
): Promise<string[]> {
  const safePath = await validatePath(path, allowedPaths);
  const results: string[] = [];
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    throw new GigaiError(ErrorCode.VALIDATION_ERROR, `Invalid search pattern: ${pattern}`);
  }

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (regex.test(entry.name)) {
        results.push(relative(safePath, fullPath));
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(safePath);
  return results;
}
