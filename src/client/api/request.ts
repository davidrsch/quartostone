// src/client/api/request.ts
// Thin wrapper around fetch that injects the session Bearer token on every
// request to /api/* routes.  Call initToken() once at startup; all subsequent
// apiFetch() calls will include the Authorization header automatically.

let _token: string | null = null;

/** Fetch the session token from the server and store it in module state. */
export async function initToken(): Promise<void> {
  const res = await fetch('/api/session');
  const data = await res.json() as { token: string | null };
  _token = data.token;
}

/** Return auth headers, or an empty object when no token is configured (test mode). */
export function getAuthHeaders(): Record<string, string> {
  if (!_token) return {};
  return { Authorization: `Bearer ${_token}` };
}

/** Return the current session token (used for WebSocket query-string auth). */
export function getToken(): string | null { return _token; }

/** Drop-in replacement for fetch() that adds the Bearer auth header. */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined ?? {}),
    ...getAuthHeaders(),
  };
  return fetch(url, { ...init, headers });
}
