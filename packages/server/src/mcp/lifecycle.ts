import type { McpPool } from "./pool.js";

export class McpLifecycleManager {
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private pool: McpPool) {}

  startHealthChecks(intervalMs = 30_000): void {
    this.healthCheckInterval = setInterval(async () => {
      for (const name of this.pool.list()) {
        try {
          const client = this.pool.getClient(name);
          if (client.isConnected) {
            await client.listTools(); // Ping by listing tools
          }
        } catch {
          // Client will auto-reconnect on next use via ensureConnected()
        }
      }
    }, intervalMs);
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    await this.pool.shutdownAll();
  }
}
