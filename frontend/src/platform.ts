import { Capacitor } from '@capacitor/core';

export const nativeApp = Capacitor.isNativePlatform();
// Web builds keep their existing same-origin proxy. Only the installed app uses this address.
export const apiOrigin = nativeApp ? (import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '') : '';

export function apiUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('接口路径无效');
  if (nativeApp && !apiOrigin) throw new Error('应用缺少服务器地址，请重新构建安装包');
  return apiOrigin + '/api/v1' + path;
}
