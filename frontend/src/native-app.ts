import { App } from '@capacitor/app';
import type { Router } from 'vue-router';
import { nativeApp } from './platform';

export async function setupNativeApp(router: Router): Promise<void> {
  if (!nativeApp) return;
  document.documentElement.dataset.nativeApp = 'android';
  await App.addListener('backButton', ({ canGoBack }) => {
    // Let Element Plus dismiss the topmost dialog or drawer before leaving the page.
    const overlays = Array.from(document.querySelectorAll<HTMLElement>('.el-overlay'))
      .filter(element => element.getBoundingClientRect().height > 0);
    const close = overlays.at(-1)?.querySelector<HTMLButtonElement>('.el-dialog__headerbtn, .el-drawer__close-btn, .el-message-box__headerbtn');
    if (close) { close.click(); return; }
    if (canGoBack) router.back();
    else void App.minimizeApp();
  });
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event('todo-app-resume'));
  });
}
