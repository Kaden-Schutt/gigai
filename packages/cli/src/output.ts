import { homedir } from "node:os";

export function output(value: string | object): void {
  if (typeof value === "string") {
    process.stdout.write(value + "\n");
  } else {
    process.stdout.write(JSON.stringify(value) + "\n");
  }
}

export function outputError(code: string, message: string): void {
  process.stdout.write(JSON.stringify({ error: code, message }) + "\n");
  process.exitCode = 1;
}

export function homePath(absolute: string): string {
  const home = homedir();
  if (absolute === home) return "~";
  if (absolute.startsWith(home + "/")) return "~/" + absolute.slice(home.length + 1);
  return absolute;
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return homedir() + path.slice(1);
  return path;
}

export function classifyError(err: unknown): string {
  if (err instanceof Error && "statusCode" in err) {
    const status = (err as any).statusCode as number;
    const serverCode = (err as any).errorCode as string | undefined;
    if (serverCode) return serverCode;
    if (status === 401) return "AUTH_EXPIRED";
    if (status === 403) return "FORBIDDEN";
    if (status === 404) return "NOT_FOUND";
    if (status === 429) return "RATE_LIMITED";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(msg)) return "SERVER_UNAVAILABLE";
  if (/pair|auth/i.test(msg)) return "AUTH_FAILED";
  return "ERROR";
}
