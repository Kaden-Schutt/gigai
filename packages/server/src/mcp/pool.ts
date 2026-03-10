import type { McpToolConfig, McpToolInfo } from "@gigai/shared";
import { KondError, ErrorCode } from "@gigai/shared";
import { McpClientWrapper } from "./client.js";

export class McpPool {
  private clients = new Map<string, McpClientWrapper>();

  loadFromConfig(tools: McpToolConfig[]): void {
    for (const tool of tools) {
      this.clients.set(tool.name, new McpClientWrapper(tool));
    }
  }

  getClient(name: string): McpClientWrapper {
    const client = this.clients.get(name);
    if (!client) {
      throw new KondError(ErrorCode.TOOL_NOT_FOUND, `MCP tool not found: ${name}`);
    }
    return client;
  }

  has(name: string): boolean {
    return this.clients.has(name);
  }

  async listToolsFor(name: string): Promise<McpToolInfo[]> {
    const client = this.getClient(name);
    return client.listTools();
  }

  list(): string[] {
    return Array.from(this.clients.keys());
  }

  async shutdownAll(): Promise<void> {
    const disconnects = Array.from(this.clients.values()).map((c) => c.disconnect());
    await Promise.allSettled(disconnects);
    this.clients.clear();
  }
}
