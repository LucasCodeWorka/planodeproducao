export function withNoCache(url: string) {
  const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  u.searchParams.set('_ts', String(Date.now()));
  if (typeof window === 'undefined' && !/^https?:\/\//i.test(url)) {
    return `${u.pathname}${u.search}`;
  }
  return u.toString();
}

export function fetchNoCache(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');

  return fetch(withNoCache(input), {
    ...init,
    cache: 'no-store',
    headers,
  });
}
