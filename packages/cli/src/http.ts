import type { ErrorResponse } from "@gigai/shared";

export interface HttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete(path: string): Promise<void>;
  postMultipart<T>(path: string, formData: FormData): Promise<T>;
  getRaw(path: string): Promise<Response>;
}

async function getProxyDispatcher(): Promise<unknown | undefined> {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxyUrl) return undefined;

  try {
    // Node 20+ ships undici — use its ProxyAgent
    const undici = await import("undici");
    return new undici.ProxyAgent(proxyUrl);
  } catch {
    return undefined;
  }
}

// Cache the dispatcher so we only create it once
let _dispatcher: unknown | undefined | null = null;

async function ensureDispatcher(): Promise<unknown | undefined> {
  if (_dispatcher === null) {
    _dispatcher = await getProxyDispatcher();
  }
  return _dispatcher;
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

    const dispatcher = await ensureDispatcher();
    const fetchOpts: any = {
      ...init,
      headers,
    };
    if (dispatcher) {
      fetchOpts.dispatcher = dispatcher;
    }

    const res = await fetch(`${baseUrl}${path}`, fetchOpts);

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

    async delete(path: string): Promise<void> {
      const headers: Record<string, string> = {};
      if (sessionToken) {
        headers["Authorization"] = `Bearer ${sessionToken}`;
      }
      const dispatcher = await ensureDispatcher();
      const fetchOpts: any = { method: "DELETE", headers };
      if (dispatcher) {
        fetchOpts.dispatcher = dispatcher;
      }
      const res = await fetch(`${baseUrl}${path}`, fetchOpts);
      if (!res.ok) {
        let errorBody: ErrorResponse | undefined;
        try {
          errorBody = await res.json() as ErrorResponse;
        } catch {}
        throw new Error(errorBody?.error?.message ?? `HTTP ${res.status}`);
      }
    },

    async postMultipart<T>(path: string, formData: FormData): Promise<T> {
      const headers: Record<string, string> = {};
      if (sessionToken) {
        headers["Authorization"] = `Bearer ${sessionToken}`;
      }

      const dispatcher = await ensureDispatcher();
      const fetchOpts: any = {
        method: "POST",
        headers,
        body: formData,
      };
      if (dispatcher) {
        fetchOpts.dispatcher = dispatcher;
      }

      const res = await fetch(`${baseUrl}${path}`, fetchOpts);

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

      const dispatcher = await ensureDispatcher();
      const fetchOpts: any = { headers };
      if (dispatcher) {
        fetchOpts.dispatcher = dispatcher;
      }

      const res = await fetch(`${baseUrl}${path}`, fetchOpts);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    },
  };
}
