import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ timezoneId: 'America/Los_Angeles' });

for (const type of ['email', 'phone'] as const) {
  test(`${type === 'email' ? '任意邮箱' : '电话号码'}无需验证注册、自动登录、退出重新登录与账户删除`, async ({ page }, info) => {
    const identifier = type === 'email' ? `browser-${randomUUID()}@unreachable.invalid` : '139' + String(BigInt('0x' + randomUUID().replaceAll('-', '')) % 100000000n).padStart(8, '0');
    const normalized = type === 'email' ? identifier : '+86' + identifier;
    const nickname = type === 'email' ? '🌱 学习小伙伴' : '专注小伙伴';
    const password = 'browser-registration-password', origin = 'http://localhost:5174';
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const authRequests: string[] = []; page.on('request', r => { if (r.url().includes('/auth/')) authRequests.push(r.url()); });
    let created = false, deleted = false;
    try {
      await page.goto('/auth');
      await page.getByRole('button', { name: '创建账户', exact: true }).click();
      await expect(page.getByRole('button', { name: '重发验证邮件', exact: true })).toHaveCount(0);
      if (type === 'email') await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
      await expect(page.getByRole('combobox', { name: '时区', exact: true })).toHaveCount(0);
      await page.getByRole('textbox', { name: '昵称', exact: true }).fill('  ' + nickname + '  ');
      await page.getByRole('textbox', { name: type === 'email' ? '邮箱' : '手机号码', exact: true }).fill(identifier);
      await page.getByRole('textbox', { name: '密码', exact: true }).fill(password);
      await page.getByRole('textbox', { name: '确认密码', exact: true }).fill(password);
      const registered = page.waitForResponse(r => r.url().endsWith('/auth/register') && r.request().method() === 'POST');
      await page.getByRole('textbox', { name: '确认密码', exact: true }).press('Enter');
      const registration = await registered;
      expect(registration.status()).toBe(201); created = true;
      expect(registration.request().postDataJSON().timezone).toBe('America/Los_Angeles');
      expect(registration.request().postDataJSON().nickname).toBe(nickname);
      expect((await registration.json()).user.nickname).toBe(nickname);
      await expect(page.getByRole('heading', { name: '今日清单', exact: true })).toBeVisible();
      await page.goto('/account'); await expect(page.locator('.account-identity')).toContainText(nickname);
      await expect(page.locator('.account-identity-avatar')).toHaveText(Array.from(nickname)[0]);
      await expect(page.getByRole('textbox', { name: '账户时区', exact: true })).toHaveValue('America/Los_Angeles');
      await page.reload(); await expect(page.locator('.account-identity')).toContainText(nickname);
      const session = await (await page.request.get('/api/v1/me')).json();
      expect((await page.request.post('/api/v1/auth/logout', { headers: { origin, 'x-csrf-token': session.csrf_token } })).ok()).toBe(true);
      await page.goto('/auth');
      await page.getByRole('textbox', { name: '邮箱或电话号码', exact: true }).fill(identifier);
      await page.getByRole('textbox', { name: '密码', exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('heading', { name: '今日清单', exact: true })).toBeVisible();
      await page.goto('/account');
      await expect(page.locator('.account-identity')).toContainText(nickname);
      await page.getByRole('navigation', { name: '账户设置分区', exact: true }).getByRole('link', { name: '账户安全', exact: true }).click();
      await expect(page.getByText('登录账号：' + normalized, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '永久删除账户', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText(type === 'phone' ? '输入当前电话号码' : '输入当前邮箱');
      await page.getByRole('dialog').getByRole('textbox').fill(normalized);
      const deletion = page.waitForResponse(r => r.url().endsWith('/account-deletion') && r.request().method() === 'POST');
      await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
      expect((await deletion).status()).toBe(200); deleted = true;
      await expect(page.getByRole('textbox', { name: '邮箱或电话号码', exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath('registration-login.png'), fullPage: true });
      expect(authRequests.some(url => url.endsWith('/auth/verify') || url.endsWith('/auth/resend-verification'))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      if (created && !deleted) {
        const login = await page.request.post('/api/v1/auth/login', { headers: { origin }, data: { identifier, password } });
        if (login.ok()) expect((await page.request.post('/api/v1/account-deletion', { headers: { origin, 'x-csrf-token': (await login.json()).csrf_token }, data: { confirm_identifier: normalized } })).ok()).toBe(true);
      }
    }
  });
}

test('注册方式、格式和确认密码校验、重复注册提示及三种主题布局', async ({ page }, info) => {
  const requests: any[] = [];
  await page.route('**/api/v1/me', route => route.fulfill({ status: 401, json: { detail: '请先登录' } }));
  await page.route('**/api/v1/auth/register', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { detail: '该账号已注册，请直接登录' } });
  });
  await page.goto('/auth');
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await expect(page.getByRole('button', { name: '手机号注册', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: '昵称', exact: true })).toHaveAttribute('maxlength', '30');
  await page.getByRole('button', { name: '注册并进入工作台', exact: true }).click();
  await expect(page.getByText('请输入手机号码', { exact: true })).toBeVisible();
  await expect(page.getByText('密码至少需要 10 个字符', { exact: true })).toBeVisible();
  await expect(page.getByText('请再次输入密码', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('textbox', { name: '手机号码', exact: true }).fill('123');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('registration-password');
  await page.getByRole('textbox', { name: '确认密码', exact: true }).fill('different-password');
  await page.getByRole('textbox', { name: '确认密码', exact: true }).press('Enter');
  await expect(page.getByText('两次输入的密码不一致', { exact: true })).toBeVisible();
  await expect(page.getByText('请输入有效的电话号码，国际号码可使用 +国家区号', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '手机号码', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('invalid-email');
  await page.getByRole('button', { name: '注册并进入工作台', exact: true }).click();
  await expect(page.getByText('请输入有效的邮箱地址', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('user@unreachable.invalid');
  await page.getByRole('textbox', { name: '确认密码', exact: true }).fill('registration-password');
  await expect(page.getByText('两次输入的密码不一致', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '注册并进入工作台', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '该账号已注册，请直接登录' })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ identifier: 'user@unreachable.invalid', timezone: 'America/Los_Angeles', nickname: null });
  await expect(page.getByRole('textbox', { name: '密码', exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByRole('textbox', { name: '确认密码', exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '返回登录', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '确认密码', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '昵称', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '密码', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await page.getByRole('button', { name: '手机号注册', exact: true }).click();
  for (const theme of ['light', 'dark', 'warm']) {
    await page.evaluate(async value => { const modulePath = '/src/themes.ts'; const themes = await import(modulePath); themes.applyTheme(value); }, theme);
    await page.screenshot({ path: info.outputPath('registration-' + theme + '.png'), fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
  await page.screenshot({ path: info.outputPath('registration-email-warm.png'), fullPage: true, animations: 'disabled' });
});
