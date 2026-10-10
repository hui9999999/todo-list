import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5174';

async function account(page: Page) {
  const email = `browser-statistics-${randomUUID()}@example.com`;
  const password = 'statistics-test-password';
  const registered = await page.request.post('/api/v1/auth/register', { headers: { Origin: origin }, data: { email, password } });
  expect(registered.status()).toBe(201);
  const response = await page.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { email, password } });
  expect(response.status()).toBe(200);
  return { Origin: origin, 'X-CSRF-Token': (await response.json()).csrf_token };
}

test('真实任务统计、重复完成去重、图表筛选和任务详情', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const headers = await account(page);
  const project = await (await page.request.post('/api/v1/projects', { headers, data: { title: '统计验收项目', scope: 'work' } })).json();
  let completed = await (await page.request.post('/api/v1/tasks', { headers,
    data: { title: '验收图表', scope: 'work', project_id: project.id } })).json();
  for (const status of ['done', 'todo', 'done']) {
    const response = await page.request.put('/api/v1/tasks/' + completed.id, { headers,
      data: { title: completed.title, scope: completed.scope, status, project_id: project.id, version: completed.version } });
    expect(response.status()).toBe(200); completed = await response.json();
  }
  expect((await page.request.post('/api/v1/tasks', { headers,
    data: { title: '逾期重点任务', scope: 'life', priority: 'high', due_date: '2020-01-01' } })).status()).toBe(201);
  await page.goto('/stats');
  await expect(page.locator('.statistics-metrics article').filter({ hasText: '期间完成任务' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.statistics-metrics article').filter({ hasText: '期间新增任务' }).locator('strong')).toHaveText('2');
  await expect(page.locator('.statistics-donut strong')).toHaveText('2');
  await expect(page.getByRole('group', { name: '完成与新增趋势图', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: '专注时长趋势图', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '高优先级 1 项，查看任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '高优先级待处理任务', exact: true })).toBeVisible();
  await page.locator('.statistics-task-row').filter({ hasText: '逾期重点任务' }).click();
  await expect(page.getByRole('textbox', { name: '任务名称', exact: true })).toHaveValue('逾期重点任务');
  await page.getByRole('button', { name: '关闭此对话框', exact: true }).click();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.statistics-details .statistics-task-row')).toHaveCount(2);
  await page.locator('.statistics-donut-legend button').filter({ hasText: '生活' }).click();
  await expect(page.locator('.statistics-details')).toContainText('没有符合条件的完成记录');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('图表完整日期、长周期、无数据、键盘交互及主题布局', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const tasks = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `task-${i}`, title: `统计演示任务 ${i + 1}`, status: ['done', 'todo', 'doing', 'done', 'failed', 'cancelled', 'done', 'todo'][i], scope: i % 2 ? 'life' : 'work', priority: i % 3 ? 'mid' : 'high', project_id: i < 5 ? 'project-a' : 'project-b', version: 1, hidden: false, parent_id: null, notes: '', due_date: i === 1 ? '2020-01-01' : null, due_at: null, created_at: '2026-09-01T00:00:00Z' })),
  ];
  let empty = false;
  await page.route('**/api/v1/me', route => route.fulfill({ json: { user: { id: 'chart-test', email: 'chart@example.com', timezone: 'Asia/Shanghai' }, csrf_token: 'test' } }));
  await page.route('**/api/v1/tasks*', route => route.fulfill({ json: route.request().url().includes('trash=true') || empty ? [] : tasks }));
  await page.route('**/api/v1/daily-plans*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/settings', route => route.fulfill({ json: { theme: 'light' } }));
  await page.route('**/api/v1/projects', route => route.fulfill({ json: [{ id: 'project-a', title: '产品改进' }, { id: 'project-b', title: '日常生活' }] }));
  await page.route('**/api/v1/statistics?*', route => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start')!, end = url.searchParams.get('end')!;
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    const daily = Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10),
      completed: empty ? 0 : [2, 0, 4, 1, 3, 0, 2][i % 7], created: empty ? 0 : [1, 3, 2, 0, 1][i % 5], focus_seconds: empty ? 0 : [1500, 3600, 0, 4200, 1800][i % 5] }));
    const events = daily.reduce((sum, day) => sum + day.completed, 0);
    const summary = { completed_tasks: empty ? 0 : 8, completion_events: events, created_tasks: daily.reduce((sum, day) => sum + day.created, 0), focus_seconds: daily.reduce((sum, day) => sum + day.focus_seconds, 0) };
    const work = Math.round(events * 0.7);
    return route.fulfill({ json: { start, end, summary, daily, scopes: { work, life: events - work }, completion_priorities: { high: Math.floor(events / 3), mid: events - Math.floor(events / 3) }, states: {}, previous: { completed_tasks: 6, completion_events: 9, created_tasks: 10, focus_seconds: 7200, start: '2026-08-03', end: '2026-09-01' },
      completed: empty ? [] : daily.filter(day => day.completed).map((day, i) => ({ event_id: `event-${i}`, task_id: `task-${i % 8}`, title: `统计演示任务 ${i % 8 + 1}`, occurred_at: `${day.date}T04:00:00Z`, date: day.date, scope: i % 2 ? 'life' : 'work', priority: 'mid' })) } });
  });
  await page.goto('/stats');
  const trend = page.getByRole('group', { name: '完成与新增趋势图', exact: true });
  await expect(trend.getByRole('button')).toHaveCount(30);
  await trend.getByRole('button').first().focus();
  await expect(page.locator('.chart-readout').first()).toContainText('完成次数 2');
  await trend.getByRole('button').first().press('Enter');
  await expect(page.locator('.statistics-details .statistics-task-row')).toHaveCount(1);
  await page.getByRole('button', { name: '近 90 天', exact: true }).click();
  await expect(trend.getByRole('button')).toHaveCount(13);
  await expect(page.getByText('每 7 天汇总展示', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '近 30 天', exact: true }).click();
  await expect(trend.getByRole('button')).toHaveCount(30);
  await trend.getByRole('button').last().focus();
  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await expect(trend.getByRole('button')).toHaveCount(7);
  await expect(page.locator('.chart-readout').first()).not.toContainText('undefined');
  await page.getByRole('button', { name: '近 30 天', exact: true }).click();
  await expect(trend.getByRole('button')).toHaveCount(30);
  await page.screenshot({ path: info.outputPath('statistics-light.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: info.outputPath('statistics-dark.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('textbox', { name: '统计开始日期', exact: true }).fill('2026-10-02');
  await page.getByRole('textbox', { name: '统计结束日期', exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: '更新统计', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('结束日期不能早于开始日期');
  empty = true;
  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await expect(trend.getByRole('button')).toHaveCount(7);
  await expect(page.locator('.statistics-donut strong')).toHaveText('0');
  await expect(page.locator('.statistics-details')).toContainText('没有符合条件的完成记录');
  expect(errors).toEqual([]);
});
