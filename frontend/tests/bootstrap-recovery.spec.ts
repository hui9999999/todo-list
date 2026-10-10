import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('登录会话接口异常时显示重试，恢复后进入登录页', async ({ page }) => {
  let unavailable = true;
  await page.route('**/api/v1/me', route => unavailable
    ? route.fulfill({ status: 503, json: { detail: '数据库暂时不可用' } })
    : route.fulfill({ status: 401, json: { detail: '请先登录' } }));
  await page.goto('/ai');
  await expect(page.getByRole('heading', { name: '暂时无法打开清单' })).toBeVisible();
  unavailable = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '邮箱或电话号码', exact: true })).toBeVisible();
});

test('桌面启动时工作台不可达，显示恢复入口且重试后显示登录页', async ({}, info) => {
  test.skip(info.project.name !== 'desktop');
  const data = info.outputPath('native-profile');
  await mkdir(data, { recursive: true });
  const root = path.resolve('..');
  const app = await electron.launch({
    executablePath: path.join(root, 'desktop/node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'desktop')],
    env: { ...process.env, XIAOQI_TEST_DATA: data, WORKBENCH_URL: 'http://127.0.0.1:5199' },
  });
  try {
    await expect.poll(() => app.windows().length).toBe(2);
    await expect.poll(() => app.windows().some(page => page.url().endsWith('/pet.html'))).toBe(true);
    const chat = app.windows().find(page => !page.url().endsWith('/pet.html'))!;
    await expect(chat.getByRole('heading', { name: '暂时无法连接工作台', exact: true })).toBeVisible();
    await chat.route('http://127.0.0.1:5199/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/me') return route.fulfill({ status: 401, json: { detail: '请先登录' } });
      // Reuse the running development app, including its module graph.
      const response = await chat.request.get('http://127.0.0.1:5174' + url.pathname + url.search, { headers: { 'user-agent': 'Xiaoqi-recovery-test' } });
      return route.fulfill({ response });
    });
    await chat.getByRole('button', { name: '重新连接', exact: true }).click();
    await expect(chat.getByRole('textbox', { name: '邮箱或电话号码', exact: true })).toBeVisible({ timeout: 20000 });
  } finally { await app.close(); }
});

test('会话恢复超时后可以重试，不会一直空白', async ({ page }) => {
  let stalled = true;
  await page.route('**/api/v1/me', route => stalled ? new Promise(() => {}) : route.fulfill({ status: 401, json: { detail: '请先登录' } }));
  await page.goto('/ai');
  await expect(page.getByRole('heading', { name: '正在打开工作台', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible({ timeout: 12000 });
  stalled = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByLabel('邮箱或电话号码', { exact: true })).toBeVisible();
});

test('入口脚本未加载时保留页面提示和重新加载入口', async ({ page }) => {
  await page.route('**/src/main.ts*', route => route.abort());
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: '正在打开工作台', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible({ timeout: 12000 });
});
