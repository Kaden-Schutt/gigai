import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ToolListResponse, ToolSummary, ToolDetailResponse } from "@gigai/shared";
import type { HttpClient } from "./http.js";

const MANIFEST_TTL = 5 * 60 * 1000; // 5 minutes

interface ManifestCache {
  tools: ToolSummary[];
  fetchedAt: number;
}

function getManifestPath(): string {
  const dir = process.env.GIGAI_CONFIG_DIR ?? join(homedir(), ".gigai");
  return join(dir, "tool-manifest.json");
}

export async function fetchTools(http: HttpClient): Promise<ToolSummary[]> {
  // Check cache first
  try {
    const raw = await readFile(getManifestPath(), "utf8");
    const cache: ManifestCache = JSON.parse(raw);
    if (Date.now() - cache.fetchedAt < MANIFEST_TTL) {
      return cache.tools;
    }
  } catch {
    // No cache or invalid
  }

  const res = await http.get<ToolListResponse>("/tools");

  // Cache the result
  try {
    const dir = process.env.GIGAI_CONFIG_DIR ?? join(homedir(), ".gigai");
    await mkdir(dir, { recursive: true });
    const cache: ManifestCache = { tools: res.tools, fetchedAt: Date.now() };
    await writeFile(getManifestPath(), JSON.stringify(cache));
  } catch {
    // Cache write failure is non-fatal
  }

  return res.tools;
}

export async function fetchToolDetail(
  http: HttpClient,
  name: string,
): Promise<ToolDetailResponse> {
  return http.get<ToolDetailResponse>(`/tools/${encodeURIComponent(name)}`);
}
