/** Shared browser API client. Credentials remain in this tab's memory. */
export const API_BASE = (import.meta.env?.VITE_API_BASE || '/api/v1').replace(/\/$/, '');
let key: string | null = null;
let pendingKey: Promise<string> | null = null;

export async function generateApiKey(): Promise<string> {
  if (!pendingKey) {
    pendingKey = (async () => {
      const res = await fetch(`${API_BASE}/auth/generate-key`, { method: 'POST' });
      if (!res.ok) throw new Error(`Could not generate API key (HTTP ${res.status}).`);
      const data = await res.json();
      if (typeof data.api_key !== 'string' || !data.api_key) throw new Error('API returned no key.');
      key = data.api_key;
      return key!;
    })().finally(() => { pendingKey = null; });
  }
  return pendingKey;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const request = () => {
    const headers = new Headers(init.headers);
    if (key) headers.set('x-api-key', key);
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  const res = await request();
  if (res.status !== 401 || init.signal?.aborted) return res;
  await generateApiKey();
  return request();
}
