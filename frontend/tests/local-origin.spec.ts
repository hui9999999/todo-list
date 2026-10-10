import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

for (const origin of ['http://localhost:5174', 'http://127.0.0.1:5174']) {
  test(`本地地址 ${origin} 可登录并刷新恢复会话`, async ({ page, context }) => {
    const identifier = `local-origin-${randomUUID()}@example.invalid`;
    const password = 'local-origin-regression-password';
    const api = origin + '/api/v1';
    let created = false;
    try {
      const registration = await page.request.post(api + '/auth/register', {
        headers: { origin }, data: { identifier, password, timezone: 'Asia/Shanghai' },
      });
      expect(registration.status()).toBe(201);
      created = true;
      await context.clearCookies();
      await page.goto(origin + '/auth');
      await page.getByRole('textbox', { name: '邮箱或电话号码', exact: true }).fill(identifier);
      await page.getByRole('textbox', { name: '密码', exact: true }).fill(password);
      const response = page.waitForResponse(r => r.url() === api + '/auth/login');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(page.getByRole('heading', { name: '今日清单', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: '今日清单', exact: true })).toBeVisible();
      expect((await (await page.request.get(api + '/me')).json()).user.identifier).toBe(identifier);
    } finally {
      if (created) {
        const login = await page.request.post(api + '/auth/login', {
          headers: { origin }, data: { identifier, password },
        });
        expect(login.ok()).toBe(true);
        const session = await login.json();
        const deleted = await page.request.post(api + '/account-deletion', {
          headers: { origin, 'x-csrf-token': session.csrf_token },
          data: { confirm_identifier: identifier },
        });
        expect(deleted.ok()).toBe(true);
      }
    }
  });
}
