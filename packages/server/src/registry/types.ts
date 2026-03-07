import type { CliToolConfig, McpToolConfig, ScriptToolConfig, BuiltinToolConfig } from "@gigai/shared";

export type RegistryEntry =
  | { type: "cli"; config: CliToolConfig }
  | { type: "mcp"; config: McpToolConfig }
  | { type: "script"; config: ScriptToolConfig }
  | { type: "builtin"; config: BuiltinToolConfig };
