import type { FastifyInstance } from "fastify";
import { GigaiError, ErrorCode } from "@gigai/shared";
import { parseAtExpression } from "../cron/scheduler.js";

export async function cronRoutes(server: FastifyInstance) {
  // List all cron jobs
  server.get("/cron", async () => {
    return { jobs: server.scheduler.listJobs() };
  });

  // Add a cron job
  server.post<{
    Body: { schedule: string; tool: string; args: string[]; description?: string; oneShot?: boolean };
  }>("/cron", {
    schema: {
      body: {
        type: "object",
        required: ["schedule", "tool", "args"],
        properties: {
          schedule: { type: "string" },
          tool: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          description: { type: "string" },
          oneShot: { type: "boolean" },
        },
      },
    },
  }, async (request) => {
    let { schedule, tool, args, description, oneShot } = request.body;

    // Handle @at prefix: convert human-readable time to cron expression
    if (schedule.startsWith("@at ")) {
      const atExpr = schedule.slice(4);
      schedule = parseAtExpression(atExpr);
      oneShot = true;
    }

    // Validate that the tool exists
    if (!server.registry.has(tool)) {
      throw new GigaiError(ErrorCode.TOOL_NOT_FOUND, `Tool not found: ${tool}`);
    }

    const job = await server.scheduler.addJob({ schedule, tool, args, description, oneShot });
    return { job };
  });

  // Remove a cron job
  server.delete<{ Params: { id: string } }>("/cron/:id", async (request, reply) => {
    const removed = await server.scheduler.removeJob(request.params.id);
    if (!removed) {
      throw new GigaiError(ErrorCode.VALIDATION_ERROR, `Cron job not found: ${request.params.id}`);
    }
    reply.status(204);
    return;
  });

  // Toggle enable/disable
  server.post<{ Params: { id: string } }>("/cron/:id/toggle", async (request) => {
    const job = await server.scheduler.toggleJob(request.params.id);
    if (!job) {
      throw new GigaiError(ErrorCode.VALIDATION_ERROR, `Cron job not found: ${request.params.id}`);
    }
    return { job };
  });
}
