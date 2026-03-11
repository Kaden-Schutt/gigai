import type { FastifyInstance } from "fastify";
import { platform } from "node:os";

export async function toolRoutes(server: FastifyInstance) {
  server.get("/tools", async () => {
    return { tools: server.registry.list(), platform: platform() };
  });

  server.get<{ Querystring: { q?: string } }>("/tools/search", async (request) => {
    const query = request.query.q?.toLowerCase().trim();
    if (!query) {
      return { tools: server.registry.list() };
    }

    const all = server.registry.list();
    const keywords = query.split(/\s+/);

    // Score each tool by keyword matches in name + description
    const scored = all.map((tool) => {
      const text = `${tool.name} ${tool.description}`.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (tool.name.toLowerCase() === kw) score += 10;
        else if (tool.name.toLowerCase().includes(kw)) score += 5;
        if (tool.description.toLowerCase().includes(kw)) score += 2;
      }
      return { tool, score };
    });

    const matches = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) => s.tool);

    return { tools: matches };
  });

  server.get<{ Params: { name: string } }>("/tools/:name", async (request) => {
    const { name } = request.params;
    const detail = await server.registry.getDetailWithHelp(name);

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
