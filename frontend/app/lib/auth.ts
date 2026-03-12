const TOKEN_KEY = 'pp_admin_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  const clean = String(token || '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '');
  localStorage.setItem(TOKEN_KEY, clean);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): HeadersInit {
  const token = String(getToken() || '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
