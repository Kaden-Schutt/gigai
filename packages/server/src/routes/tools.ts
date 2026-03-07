import type { FastifyInstance } from "fastify";

export async function toolRoutes(server: FastifyInstance) {
  server.get("/tools", async () => {
    return { tools: server.registry.list() };
  });

  server.get<{ Params: { name: string } }>("/tools/:name", async (request) => {
    const { name } = request.params;
    const detail = server.registry.getDetail(name);

    // If it's an MCP tool, attach MCP tool list
    const entry = server.registry.get(name);
    if (entry.type === "mcp") {
      try {
        const mcpTools = await server.mcpPool.listToolsFor(name);
        detail.mcpTools = mcpTools;
      } catch {
        // MCP server might not be running yet
      }
    }

    return { tool: detail };
  });

  server.get<{ Params: { name: string } }>("/tools/:name/mcp", async (request) => {
    const { name } = request.params;
    const entry = server.registry.get(name);

    if (entry.type !== "mcp") {
      return { tools: [] };
    }

    const mcpTools = await server.mcpPool.listToolsFor(name);
    return { tools: mcpTools };
  });
}
