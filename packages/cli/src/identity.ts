import { decodeJWTPayload } from "@gigai/shared";

export function getOrgUUID(): string {
  // Explicit env var
  if (process.env.GIGAI_ORG_UUID) {
    return process.env.GIGAI_ORG_UUID;
  }

  // Try to extract from proxy URL JWT
  const proxyUrl = process.env.ANTHROPIC_PROXY_URL ?? "";
  const jwtMatch = proxyUrl.match(/\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (jwtMatch) {
    try {
      const payload = decodeJWTPayload(jwtMatch[1]);
      if (payload.organization_uuid) {
        return payload.organization_uuid as string;
      }
    } catch {
      // Fall through
    }
  }

  // Try API key based extraction
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (apiKey.includes("/")) {
    const parts = apiKey.split("/");
    const jwtPart = parts.find((p) => p.includes(".") && p.split(".").length === 3);
    if (jwtPart) {
      try {
        const payload = decodeJWTPayload(jwtPart);
        if (payload.organization_uuid) {
          return payload.organization_uuid as string;
        }
      } catch {
        // Fall through
      }
    }
  }

  throw new Error(
    "Cannot determine organization UUID. Set GIGAI_ORG_UUID environment variable.",
  );
}
