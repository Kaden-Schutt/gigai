import type { ToolConfig, ToolSummary, ToolDetail } from "@gigai/shared";
import { KondError, ErrorCode } from "@gigai/shared";
import type { RegistryEntry } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, RegistryEntry>();

  loadFromConfig(tools: ToolConfig[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(config: ToolConfig): void {
    const entry: RegistryEntry = { type: config.type, config } as RegistryEntry;
    this.tools.set(config.name, entry);
  }

  get(name: string): RegistryEntry {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new KondError(ErrorCode.TOOL_NOT_FOUND, `Tool not found: ${name}`);
    }
    return entry;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolSummary[] {
    return Array.from(this.tools.values()).map((entry) => ({
      name: entry.config.name,
      type: entry.config.type,
      description: entry.config.description,
    }));
  }

  getDetail(name: string): ToolDetail {
    const entry = this.get(name);
    const detail: ToolDetail = {
      name: entry.config.name,
      type: entry.config.type,
      description: entry.config.description,
    };

    if (entry.type === "cli") {
      detail.usage = `${entry.config.command} ${(entry.config.args ?? []).join(" ")} [args...]`;
    } else if (entry.type === "script") {
      detail.usage = `${entry.config.path} [args...]`;
    }

    return detail;
  }
}
