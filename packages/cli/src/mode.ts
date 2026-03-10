export type GigaiMode = "client" | "server";

export function detectMode(): GigaiMode {
  // Explicit override
  if (process.env.KON_MODE === "client") return "client";
  if (process.env.KON_MODE === "server") return "server";

  // Anthropic proxy env vars indicate code exec container
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_PROXY_URL ||
    process.env.CLAUDE_CODE_EXEC
  ) {
    return "client";
  }

  return "server";
}
