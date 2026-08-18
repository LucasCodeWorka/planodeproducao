export function withNoCache(url: string) {
  const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  u.searchParams.set('_ts', String(Date.now()));
  if (typeof window === 'undefined' && !/^https?:\/\//i.test(url)) {
    return `${u.pathname}${u.search}`;
  }
  return u.toString();
}

export function fetchNoCache(input: string, init: RequestInit = {}, timeoutMs = 120000) {
  const headers = new Headers(init.headers || {});
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');

  const abortReason = (message: string) =>
    typeof DOMException !== 'undefined'
      ? new DOMException(message, 'AbortError')
      : new Error(message);

  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortWithReason = (reason: unknown, fallbackMessage: string) => {
    if (!controller.signal.aborted) {
      controller.abort(reason || abortReason(fallbackMessage));
    }
  };

  const onExternalAbort = () => {
    abortWithReason(externalSignal?.reason, 'Requisicao cancelada.');
  };

  if (externalSignal?.aborted) {
    onExternalAbort();
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    abortWithReason(abortReason(`Tempo esgotado apos ${timeoutMs}ms.`), 'Tempo esgotado.');
  }, timeoutMs);

  return fetch(withNoCache(input), {
    ...init,
    cache: 'no-store',
    headers,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  });
}

export function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const data = payload as Record<string, unknown>;
  const message = data.error || data.detail || data.details || data.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (Array.isArray(message) && message.length) return JSON.stringify(message);
  return fallback;
}
