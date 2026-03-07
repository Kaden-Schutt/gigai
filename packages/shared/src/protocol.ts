// Auth
export interface PairRequest {
  pairingCode: string;
  orgUuid: string;
}

export interface PairResponse {
  encryptedToken: string;
}

export interface ConnectRequest {
  encryptedToken: string;
  orgUuid: string;
}

export interface ConnectResponse {
  sessionToken: string;
  expiresAt: number;
}

// Tools
export interface ToolSummary {
  name: string;
  type: "cli" | "mcp" | "script" | "builtin";
  description: string;
}

export interface ToolDetail extends ToolSummary {
  usage?: string;
  args?: ToolArg[];
  mcpTools?: McpToolInfo[];
}

export interface ToolArg {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolListResponse {
  tools: ToolSummary[];
}

export interface ToolDetailResponse {
  tool: ToolDetail;
}

// Execution
export interface ExecRequest {
  tool: string;
  args: string[];
  timeout?: number;
}

export interface ExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface ExecMcpRequest {
  tool: string;
  mcpTool: string;
  args: Record<string, unknown>;
}

export interface ExecMcpResponse {
  content: McpContent[];
  isError: boolean;
  durationMs: number;
}

export interface McpContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
}

// Transfer
export interface UploadResponse {
  id: string;
  expiresAt: number;
}

// Health
export interface HealthResponse {
  status: "ok";
  version: string;
  uptime: number;
}

// Errors
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
