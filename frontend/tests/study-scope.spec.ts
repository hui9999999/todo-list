import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function account(page: Page) {
  const origin = 'http://localhost:5174';
  const email = `browser-study-${randomUUID()}@example.com`;
  const password = 'study-test-password';
  expect((await page.request.post('/api/v1/auth/register', { headers: { Origin: origin }, data: { email, password } })).status()).toBe(201);
  const response = await page.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { email, password } });
  expect(response.status()).toBe(200);
  return { Origin: origin, 'X-CSRF-Token': (await response.json()).csrf_token };
}

test('学习分类快速添加、编辑、筛选和统计图表贯通', async ({ page }, info) => {
  test.skip(info.project.name==='mobile','分类筛选和快捷记录在桌面布局验证，手机通过新建任务入口记录');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const headers = await account(page);
  expect((await page.request.post('/api/v1/tasks', { headers, data: { title: '工作对照任务', scope: 'work' } })).status()).toBe(201);
  await page.goto('/tasks?period=week');
  const filter = page.locator('.list-toolbar .el-segmented');
  await filter.getByText('学习', { exact: true }).click();
  await expect(page.getByText('工作对照任务', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '快速记录任务', exact: true }).fill('复习英语单词');
  await page.getByRole('button', { name: '记录任务', exact: true }).click();
  const row = page.locator('.task-row').filter({ hasText: '复习英语单词' });
  await expect(row.getByText('学习', { exact: true })).toBeVisible();
  const initial = (await (await page.request.get('/api/v1/tasks')).json()).find((task: any) => task.title === '复习英语单词');
  expect(initial.scope).toBe('study');

  await row.getByRole('button', { name: '复习英语单词', exact: true }).click();
  await page.getByRole('combobox', { name: '所属范围', exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: '生活', exact: true }).click();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(row).toHaveCount(0);
  await filter.getByText('全部', { exact: true }).click();
  await row.getByRole('button', { name: '复习英语单词', exact: true }).click();
  await page.getByRole('combobox', { name: '所属范围', exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: '学习', exact: true }).click();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(row.getByText('学习', { exact: true })).toBeVisible();
  await filter.getByText('学习', { exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('textbox', { name: '任务名称', exact: true }).fill('课程笔记');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.locator('.task-row').filter({ hasText: '课程笔记' }).getByText('学习', { exact: true })).toBeVisible();

  const current = (await (await page.request.get('/api/v1/tasks')).json()).find((task: any) => task.id === initial.id);
  expect((await page.request.put('/api/v1/tasks/' + current.id, { headers, data: { title: current.title, scope: 'study', status: 'done', version: current.version } })).status()).toBe(200);
  await page.goto('/stats');
  await expect(page.getByRole('img', { name: /完成范围分布：.*学习 1 次/ })).toBeVisible();
  await page.locator('.statistics-donut-legend button').filter({ hasText: '学习' }).click();
  await expect(page.getByRole('heading', { name: '学习完成记录', exact: true })).toBeVisible();
  await expect(page.locator('.statistics-details')).toContainText('复习英语单词');
  await page.screenshot({ path: info.outputPath('study-scope.png'), fullPage: true });
  await page.goto('/history');
  await page.getByRole('combobox', { name: '历史范围', exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: '学习', exact: true }).click();
  await page.getByRole('button', { name: '查找历史', exact: true }).click();
  await expect(page.locator('.history-search')).toContainText('复习英语单词');
  await page.goto('/recurrences');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('combobox', { name: '所属范围', exact: true }).press('ArrowDown');
  await expect(page.getByRole('option', { name: '学习', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
