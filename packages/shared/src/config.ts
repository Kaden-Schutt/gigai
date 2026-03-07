import { z } from "zod";

export const TailscaleHttpsConfigSchema = z.object({
  provider: z.literal("tailscale"),
  funnelPort: z.number().optional(),
});

export const CloudflareHttpsConfigSchema = z.object({
  provider: z.literal("cloudflare"),
  tunnelName: z.string(),
  domain: z.string().optional(),
});

export const LetsEncryptHttpsConfigSchema = z.object({
  provider: z.literal("letsencrypt"),
  domain: z.string(),
  email: z.string().email(),
  certPath: z.string().optional(),
  keyPath: z.string().optional(),
});

export const ManualHttpsConfigSchema = z.object({
  provider: z.literal("manual"),
  certPath: z.string(),
  keyPath: z.string(),
});

export const HttpsConfigSchema = z.discriminatedUnion("provider", [
  TailscaleHttpsConfigSchema,
  CloudflareHttpsConfigSchema,
  LetsEncryptHttpsConfigSchema,
  ManualHttpsConfigSchema,
]);

export const CliToolConfigSchema = z.object({
  type: z.literal("cli"),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  description: z.string(),
  timeout: z.number().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
});

export const McpToolConfigSchema = z.object({
  type: z.literal("mcp"),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  description: z.string(),
  env: z.record(z.string()).optional(),
});

export const ScriptToolConfigSchema = z.object({
  type: z.literal("script"),
  name: z.string(),
  path: z.string(),
  description: z.string(),
  timeout: z.number().optional(),
  interpreter: z.string().optional(),
});

export const BuiltinToolConfigSchema = z.object({
  type: z.literal("builtin"),
  name: z.string(),
  builtin: z.enum(["filesystem", "shell"]),
  description: z.string(),
  config: z.record(z.unknown()).optional(),
});

export const ToolConfigSchema = z.discriminatedUnion("type", [
  CliToolConfigSchema,
  McpToolConfigSchema,
  ScriptToolConfigSchema,
  BuiltinToolConfigSchema,
]);

export const AuthConfigSchema = z.object({
  encryptionKey: z.string().length(64),
  pairingTtlSeconds: z.number().default(300),
  sessionTtlSeconds: z.number().default(14400),
});

export const ServerConfigSchema = z.object({
  port: z.number().default(7443),
  host: z.string().default("0.0.0.0"),
  https: HttpsConfigSchema.optional(),
});

export const GigaiConfigSchema = z.object({
  server: ServerConfigSchema,
  auth: AuthConfigSchema,
  tools: z.array(ToolConfigSchema).default([]),
});

export type HttpsConfig = z.infer<typeof HttpsConfigSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type CliToolConfig = z.infer<typeof CliToolConfigSchema>;
export type McpToolConfig = z.infer<typeof McpToolConfigSchema>;
export type ScriptToolConfig = z.infer<typeof ScriptToolConfigSchema>;
export type BuiltinToolConfig = z.infer<typeof BuiltinToolConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type GigaiConfig = z.infer<typeof GigaiConfigSchema>;
