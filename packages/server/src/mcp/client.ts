import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GigaiError, ErrorCode, type McpToolConfig, type McpToolInfo } from "@gigai/shared";

export class McpClientWrapper {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private toolsCache: McpToolInfo[] | null = null;
  private connected = false;

  constructor(private readonly config: McpToolConfig) {}

  async ensureConnected(): Promise<void> {
    if (this.connected && this.client) return;

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env ? { ...process.env as Record<string, string>, ...this.config.env } : process.env as Record<string, string>,
    });

    this.client = new Client({
      name: `gigai-${this.config.name}`,
      version: "0.1.0",
    });

    await this.client.connect(this.transport);
    this.connected = true;
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (this.toolsCache) return this.toolsCache;

    await this.ensureConnected();
    const result = await this.client!.listTools();

    this.toolsCache = result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    return this.toolsCache;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError: boolean }> {
    await this.ensureConnected();

    try {
      const result = await this.client!.callTool({ name: toolName, arguments: args });
      return {
        content: (result.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
        isError: result.isError ?? false,
      };
    } catch (err) {
      throw new GigaiError(
        ErrorCode.MCP_ERROR,
        `MCP tool call failed: ${(err as Error).message}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.close();
      } catch {
        // Ignore close errors
      }
      this.client = null;
      this.transport = null;
      this.connected = false;
      this.toolsCache = null;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get name(): string {
    return this.config.name;
  }
}
