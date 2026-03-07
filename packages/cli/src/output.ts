import type { ToolSummary, ToolDetail } from "@gigai/shared";

export function formatToolList(tools: ToolSummary[]): string {
  if (tools.length === 0) return "No tools registered.";

  const maxName = Math.max(...tools.map((t) => t.name.length));
  const maxType = Math.max(...tools.map((t) => t.type.length));

  const lines = tools.map((t) => {
    const name = t.name.padEnd(maxName);
    const type = t.type.padEnd(maxType);
    return `  ${name}  ${type}  ${t.description}`;
  });

  return `Available tools:\n${lines.join("\n")}`;
}

export function formatToolDetail(detail: ToolDetail): string {
  const lines: string[] = [];
  lines.push(`${detail.name} (${detail.type})`);
  lines.push(`  ${detail.description}`);

  if (detail.usage) {
    lines.push(`\nUsage: ${detail.usage}`);
  }

  if (detail.args?.length) {
    lines.push("\nArguments:");
    for (const arg of detail.args) {
      const req = arg.required ? " (required)" : "";
      const def = arg.default ? ` [default: ${arg.default}]` : "";
      lines.push(`  ${arg.name}${req}${def} — ${arg.description}`);
    }
  }

  if (detail.mcpTools?.length) {
    lines.push("\nMCP Tools:");
    for (const t of detail.mcpTools) {
      lines.push(`  ${t.name} — ${t.description}`);
    }
  }

  return lines.join("\n");
}

export function formatStatus(
  connected: boolean,
  serverUrl?: string,
  sessionExpiresAt?: number,
): string {
  if (!connected) {
    return "Not connected. Run 'gigai pair <code> <server-url>' to set up.";
  }

  const lines = [`Connected to: ${serverUrl}`];
  if (sessionExpiresAt) {
    const remaining = sessionExpiresAt - Date.now();
    if (remaining > 0) {
      const mins = Math.floor(remaining / 60_000);
      lines.push(`Session expires in: ${mins} minutes`);
    } else {
      lines.push("Session expired. Will auto-renew on next command.");
    }
  }

  return lines.join("\n");
}
