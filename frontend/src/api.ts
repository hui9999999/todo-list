import { CapacitorHttp } from '@capacitor/core';
import { apiOrigin, apiUrl, nativeApp } from './platform';

let csrfToken = "";
export function setCsrf(value: string) {
  csrfToken = value;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await apiResponse(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail;
    throw new ApiError(
      response.status,
      typeof detail === "string"
        ? detail
        : detail?.message || "请求失败，请稍后重试",
    );
  }
  return body as T;
}

/** The Android HTTP bridge keeps HttpOnly cookies in the native cookie store. */
export async function apiResponse(path: string, options: RequestInit = {}, binary = false): Promise<Response> {
  const url = apiUrl(path);
  if (!nativeApp) return fetch(url, { credentials: 'same-origin', ...options });
  options.signal?.throwIfAborted();
  const headers = new Headers(options.headers);
  headers.set('Origin', apiOrigin);
  if (options.body && typeof options.body !== 'string') throw new Error('不支持的请求格式');
  const request = CapacitorHttp.request({
    url, method: options.method || 'GET', headers: Object.fromEntries(headers.entries()),
    data: options.body || undefined,
    responseType: binary ? 'blob' : 'text',
    connectTimeout: 8000, readTimeout: 35000, disableRedirects: true,
  }).then(result => {
    const responseHeaders = new Headers(result.headers);
    let body: BodyInit | null = null;
    if (result.status !== 204 && result.status !== 205) {
      if (binary && typeof result.data === 'string' && !(responseHeaders.get('content-type')?.includes('json') && /^[\s]*[\[{]/.test(result.data))) {
        body = Uint8Array.from(atob(result.data), character => character.charCodeAt(0));
      } else body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    }
    return new Response(body, { status: result.status, headers: responseHeaders });
  }).catch(error => {
    if (error instanceof TypeError || error instanceof DOMException) throw error;
    throw new Error('无法连接服务器，请检查网络后重试');
  });
  if (!options.signal) return request;
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function post<T>(path: string, body: unknown = {}) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}
