import type { ToolSummary, ToolDetail } from "@gigai/shared";
import type { ClientConfig } from "./config.js";

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

export function formatStatus(config: ClientConfig): string {
  const serverNames = Object.keys(config.servers);
  if (serverNames.length === 0) {
    return "Not connected. Run 'gigai pair <code> <server-url>' to set up.";
  }

  const lines: string[] = [];
  for (const name of serverNames) {
    const entry = config.servers[name];
    const active = name === config.activeServer ? " (active)" : "";
    lines.push(`  ${name}${active}  ${entry.server}`);
    if (entry.sessionExpiresAt) {
      const remaining = entry.sessionExpiresAt - Date.now();
      if (remaining > 0) {
        lines.push(`    Session expires in ${Math.floor(remaining / 60_000)} minutes`);
      } else {
        lines.push("    Session expired — will auto-renew on next command");
      }
    }
  }

  return `Servers:\n${lines.join("\n")}`;
}
