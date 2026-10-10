import {test, expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('账户内修改昵称、取消、次数保留与第三次限制', async ({page}, info) => {
  const identifier = `browser-nickname-${randomUUID()}@example.com`, password = 'browser-nickname-password', origin = 'http://localhost:5174';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const registration = await page.request.post('/api/v1/auth/register', {headers: {origin}, data: {identifier, password, nickname: '原昵称', timezone: 'Asia/Shanghai'}});
  expect(registration.status()).toBe(201);
  let session = await registration.json();
  const editor = page.locator('.nickname-editor');
  const input = page.getByRole('textbox', {name: '账户昵称', exact: true});
  try {
    await page.goto('/account');
    await expect(page.locator('.account-identity strong')).toHaveText('原昵称');
    await page.getByRole('button', {name: '修改昵称', exact: true}).click();
    await expect(editor).toContainText('今天还可修改 2 次');
    await expect(page.getByRole('button', {name: '保存昵称', exact: true})).toBeDisabled();
    await input.fill('取消的名字');
    await editor.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.locator('.account-identity strong')).toHaveText('原昵称');
    await page.getByRole('button', {name: '修改昵称', exact: true}).click();
    await expect(editor).toContainText('今天还可修改 2 次');
    await input.fill('  第一个新昵称  ');
    await editor.getByRole('button', {name: '保存昵称', exact: true}).click();
    await expect(page.locator('.account-identity strong')).toHaveText('第一个新昵称');
    await expect(page.locator('.account-identity-avatar')).toHaveText('第');
    await page.reload();
    await page.getByRole('button', {name: '修改昵称', exact: true}).click();
    await expect(editor).toContainText('今天还可修改 1 次');
    await input.fill('新名字'.repeat(10));
    await editor.getByRole('button', {name: '保存昵称', exact: true}).click();
    await expect(page.locator('.account-identity strong')).toHaveText('新名字'.repeat(10));
    await page.reload();
    await page.getByRole('button', {name: '修改昵称', exact: true}).click();
    await expect(editor).toContainText('今天还可修改 0 次');
    await input.fill('第三次修改');
    await expect(editor.getByRole('button', {name: '保存昵称', exact: true})).toBeDisabled();
    const bypass = await page.request.put('/api/v1/account-profile', {headers: {origin, 'x-csrf-token': session.csrf_token}, data: {nickname: '第三次修改'}});
    expect(bypass.status()).toBe(429);
    expect((await bypass.json()).detail).toContain('今天已修改 2 次');
    for (const theme of ['light', 'dark', 'warm']) {
      await page.evaluate(async value => {const path = '/src/themes.ts'; (await import(path)).applyTheme(value);}, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path: info.outputPath('nickname-' + theme + '.png'), fullPage: true, animations: 'disabled'});
    }
    expect(errors).toEqual([]);
    expect((await page.request.post('/api/v1/auth/logout', {headers: {origin, 'x-csrf-token': session.csrf_token}})).ok()).toBe(true);
    const login = await page.request.post('/api/v1/auth/login', {headers: {origin}, data: {identifier, password}});
    expect(login.ok()).toBe(true); session = await login.json();
    await page.goto('/account');
    await expect(page.locator('.account-identity strong')).toHaveText('新名字'.repeat(10));
    await page.getByRole('button', {name: '修改昵称', exact: true}).click();
    await expect(editor).toContainText('今天还可修改 0 次');
  } finally {
    expect((await page.request.post('/api/v1/account-deletion', {headers: {origin, 'x-csrf-token': session.csrf_token}, data: {confirm_identifier: identifier}})).ok()).toBe(true);
  }
});
