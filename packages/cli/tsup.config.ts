import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".js" }),
  noExternal: ["@gigai/shared", "@gigai/server"],
  external: [
    "fastify",
    "@fastify/cors",
    "@fastify/rate-limit",
    "@fastify/multipart",
    "fastify-plugin",
    "@modelcontextprotocol/sdk",
    "@inquirer/prompts",
    "nanoid",
    "zod",
  ],
});
