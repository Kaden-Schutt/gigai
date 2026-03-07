import type { ExecResponse, ExecMcpResponse } from "@gigai/shared";
import type { HttpClient } from "./http.js";

export async function execTool(
  http: HttpClient,
  name: string,
  args: string[],
  timeout?: number,
): Promise<void> {
  const res = await http.post<ExecResponse>("/exec", {
    tool: name,
    args,
    timeout,
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  process.exitCode = res.exitCode;
}

export async function execMcpTool(
  http: HttpClient,
  tool: string,
  mcpTool: string,
  args: Record<string, unknown>,
): Promise<void> {
  const res = await http.post<ExecMcpResponse>("/exec/mcp", {
    tool,
    mcpTool,
    args,
  });

  for (const content of res.content) {
    if (content.type === "text" && content.text) {
      process.stdout.write(content.text + "\n");
    } else if (content.type === "image") {
      console.log(`[Image: ${content.mimeType}]`);
    } else if (content.type === "resource") {
      console.log(`[Resource: ${content.mimeType}]`);
    }
  }

  if (res.isError) {
    process.exitCode = 1;
  }
}
