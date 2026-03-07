import type { ErrorResponse } from "@gigai/shared";

export interface HttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  postMultipart<T>(path: string, formData: FormData): Promise<T>;
  getRaw(path: string): Promise<Response>;
}

export function createHttpClient(serverUrl: string, sessionToken?: string): HttpClient {
  const baseUrl = serverUrl.replace(/\/$/, "");

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> ?? {}),
    };

    if (sessionToken) {
      headers["Authorization"] = `Bearer ${sessionToken}`;
    }

    if (!headers["Content-Type"] && init.body && typeof init.body === "string") {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!res.ok) {
      let errorBody: ErrorResponse | undefined;
      try {
        errorBody = await res.json() as ErrorResponse;
      } catch {}

      const message = errorBody?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`;
      throw new Error(message);
    }

    return res.json() as Promise<T>;
  }

  return {
    get<T>(path: string): Promise<T> {
      return request<T>(path);
    },

    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
    },

    async postMultipart<T>(path: string, formData: FormData): Promise<T> {
      const headers: Record<string, string> = {};
      if (sessionToken) {
        headers["Authorization"] = `Bearer ${sessionToken}`;
      }

      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!res.ok) {
        let errorBody: ErrorResponse | undefined;
        try {
          errorBody = await res.json() as ErrorResponse;
        } catch {}
        throw new Error(errorBody?.error?.message ?? `HTTP ${res.status}`);
      }

      return res.json() as Promise<T>;
    },

    async getRaw(path: string): Promise<Response> {
      const headers: Record<string, string> = {};
      if (sessionToken) {
        headers["Authorization"] = `Bearer ${sessionToken}`;
      }

      const res = await fetch(`${baseUrl}${path}`, { headers });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    },
  };
}
