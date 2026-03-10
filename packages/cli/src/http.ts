import type { ErrorResponse } from "@gigai/shared";

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;
  constructor(statusCode: number, message: string, errorCode?: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

export interface HttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete(path: string): Promise<void>;
  postMultipart<T>(path: string, formData: FormData): Promise<T>;
  getRaw(path: string): Promise<Response>;
}

export type OnAuthFailure = () => Promise<string | undefined>;

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

export function createHttpClient(
  serverUrl: string,
  sessionToken?: string,
  onAuthFailure?: OnAuthFailure,
): HttpClient {
  const baseUrl = serverUrl.replace(/\/$/, "");
  let currentToken = sessionToken;

  async function rawFetch(url: string, init: RequestInit & { dispatcher?: unknown }): Promise<Response> {
    const dispatcher = await ensureDispatcher();
    const fetchOpts: any = { ...init };
    if (dispatcher) fetchOpts.dispatcher = dispatcher;
    return fetch(url, fetchOpts);
  }

  function authHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (currentToken) h["Authorization"] = `Bearer ${currentToken}`;
    return h;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> ?? {}),
      ...authHeaders(),
    };

    if (!headers["Content-Type"] && init.body && typeof init.body === "string") {
      headers["Content-Type"] = "application/json";
    }

    let res = await rawFetch(`${baseUrl}${path}`, { ...init, headers });

    // Retry once on 401 if we have a refresh callback
    if (res.status === 401 && onAuthFailure) {
      const newToken = await onAuthFailure();
      if (newToken) {
        currentToken = newToken;
        headers["Authorization"] = `Bearer ${newToken}`;
        res = await rawFetch(`${baseUrl}${path}`, { ...init, headers });
      }
    }

    if (!res.ok) {
      let errorBody: ErrorResponse | undefined;
      try {
        errorBody = await res.json() as ErrorResponse;
      } catch {}

      const message = errorBody?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`;
      throw new HttpError(res.status, message, errorBody?.error?.code);
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
      let res = await rawFetch(`${baseUrl}${path}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (res.status === 401 && onAuthFailure) {
        const newToken = await onAuthFailure();
        if (newToken) {
          currentToken = newToken;
          res = await rawFetch(`${baseUrl}${path}`, {
            method: "DELETE",
            headers: authHeaders(),
          });
        }
      }

      if (!res.ok) {
        let errorBody: ErrorResponse | undefined;
        try {
          errorBody = await res.json() as ErrorResponse;
        } catch {}
        throw new HttpError(res.status, errorBody?.error?.message ?? `HTTP ${res.status}`, errorBody?.error?.code);
      }
    },

    async postMultipart<T>(path: string, formData: FormData): Promise<T> {
      let res = await rawFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });

      if (res.status === 401 && onAuthFailure) {
        const newToken = await onAuthFailure();
        if (newToken) {
          currentToken = newToken;
          res = await rawFetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: authHeaders(),
            body: formData,
          });
        }
      }

      if (!res.ok) {
        let errorBody: ErrorResponse | undefined;
        try {
          errorBody = await res.json() as ErrorResponse;
        } catch {}
        throw new HttpError(res.status, errorBody?.error?.message ?? `HTTP ${res.status}`, errorBody?.error?.code);
      }

      return res.json() as Promise<T>;
    },

    async getRaw(path: string): Promise<Response> {
      let res = await rawFetch(`${baseUrl}${path}`, {
        headers: authHeaders(),
      });

      if (res.status === 401 && onAuthFailure) {
        const newToken = await onAuthFailure();
        if (newToken) {
          currentToken = newToken;
          res = await rawFetch(`${baseUrl}${path}`, {
            headers: authHeaders(),
          });
        }
      }

      if (!res.ok) {
        throw new HttpError(res.status, `HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    },
  };
}
