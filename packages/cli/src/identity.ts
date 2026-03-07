import { decodeJWTPayload } from "@gigai/shared";

export function getOrgUUID(): string {
  // Explicit env var
  if (process.env.GIGAI_ORG_UUID) {
    return process.env.GIGAI_ORG_UUID;
  }

  // Extract from HTTP_PROXY / HTTPS_PROXY JWT (Claude code execution environment)
  // Format: http://jwt_<token>@proxy-host:port
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  const jwtMatch = proxyUrl.match(/jwt_([^@]+)/);
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

  // Also try ANTHROPIC_PROXY_URL if set
  const anthropicProxy = process.env.ANTHROPIC_PROXY_URL ?? "";
  const anthropicJwtMatch = anthropicProxy.match(/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (anthropicJwtMatch) {
    try {
      const payload = decodeJWTPayload(anthropicJwtMatch[1]);
      if (payload.organization_uuid) {
        return payload.organization_uuid as string;
      }
    } catch {
      // Fall through
    }
  }

  // Try API key based extraction
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (apiKey.includes(".")) {
    try {
      const payload = decodeJWTPayload(apiKey);
      if (payload.organization_uuid) {
        return payload.organization_uuid as string;
      }
    } catch {
      // Fall through
    }
  }

  throw new Error(
    "Cannot determine organization UUID. Set GIGAI_ORG_UUID environment variable.",
  );
}
