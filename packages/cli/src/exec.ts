import type { ExecResponse, ExecMcpResponse } from "@gigai/shared";
import type { HttpClient } from "./http.js";
import { output, outputError } from "./output.js";

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

  if (res.exitCode === 0) {
    if (res.stdout) process.stdout.write(res.stdout);
  } else {
    const err: Record<string, unknown> = {
      error: "EXEC_FAILED",
      message: res.stderr?.trim() || `Exited with code ${res.exitCode}`,
      exitCode: res.exitCode,
    };
    if (res.stdout) err.stdout = res.stdout;
    if (res.stderr) err.stderr = res.stderr;
    output(err);
    process.exitCode = 1;
  }
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

  if (res.isError) {
    const errorText = res.content
      .filter(c => c.type === "text" && c.text)
      .map(c => c.text)
      .join("\n");
    outputError("EXEC_FAILED", errorText || "MCP tool execution failed");
    return;
  }

  for (const content of res.content) {
    if (content.type === "text" && content.text) {
      process.stdout.write(content.text + "\n");
    } else if (content.type === "image") {
      output({ type: "image", mimeType: content.mimeType });
    } else if (content.type === "resource") {
      output({ type: "resource", mimeType: content.mimeType });
    }
  }
}
