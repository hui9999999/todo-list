import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('真实接口：生成周报月报、历史保存、重复更新和自动生成开关', async ({ page }, info) => {
  const origin = 'http://localhost:5174', email = 'browser-report-' + randomUUID() + '@example.com', password = 'browser-report-password';
  let csrf = '';
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    expect((await page.request.post('/api/v1/auth/register', { headers: { origin }, data: { email, password } })).status()).toBe(201);
    const login = await page.request.post('/api/v1/auth/login', { headers: { origin }, data: { email, password } });
    expect(login.ok()).toBe(true); csrf = (await login.json()).csrf_token;
    const headers = { origin, 'x-csrf-token': csrf };
    expect((await page.request.post('/api/v1/tasks', { headers, data: { title: '周报完成事项', scope: 'study', status: 'done' } })).status()).toBe(201);
    expect((await page.request.post('/api/v1/tasks', { headers, data: { title: '周报后续事项', priority: 'high', due_date: '2020-01-01' } })).status()).toBe(201);
    await page.goto('/stats'); await page.getByRole('button', { name: '周报与月报', exact: true }).click();
    await expect(page.getByRole('heading', { name: '还没有报告', exact: true })).toBeVisible();
    await expect(page.getByRole('switch', { name: '自动周报', exact: true })).toBeChecked();
    await page.getByRole('button', { name: '生成周报', exact: true }).click();
    await expect(page.getByText('报告已生成并保存', { exact: true })).toBeVisible();
    await expect(page.locator('.report-task').filter({ hasText: '周报完成事项' })).toBeVisible();
    await expect(page.locator('.report-task').filter({ hasText: '周报后续事项' })).toBeVisible();
    await expect(page.getByRole('group', { name: '报告完成与新增趋势图', exact: true })).toBeVisible();
    await expect(page.locator('.report-history-items button')).toHaveCount(1);
    await page.getByRole('button', { name: '生成周报', exact: true }).click();
    await expect(page.getByRole('button', { name: '生成周报', exact: true })).toBeEnabled();
    await expect(page.locator('.report-history-items button')).toHaveCount(1);
    await page.getByRole('group', { name: '报告类型', exact: true }).getByRole('button', { name: '月报', exact: true }).click();
    await page.getByRole('button', { name: '生成月报', exact: true }).click();
    await expect(page.locator('.report-history-items button')).toHaveCount(2);
    await expect(page.locator('.report-heading h2')).toContainText('月报');
    await page.locator('.report-switches .el-switch').first().click();
    await expect(page.getByRole('switch', { name: '自动周报', exact: true })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: '自动周报', exact: true })).toBeEnabled();
    await page.reload(); await page.getByRole('button', { name: '周报与月报', exact: true }).click();
    await expect(page.locator('.report-history-items button')).toHaveCount(2);
    await expect(page.getByRole('switch', { name: '自动周报', exact: true })).not.toBeChecked();
    await page.locator('.report-history-items button').filter({ hasText: '周报' }).click();
    await expect(page.locator('.report-heading h2')).toContainText('周报');
    await page.screenshot({ path: info.outputPath('period-reports-live.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    if (csrf) expect((await page.request.post('/api/v1/account-deletion', { headers: { origin, 'x-csrf-token': csrf }, data: { confirm_email: email } })).ok()).toBe(true);
  }
});

test('丰富报告图表、失败重试、月份与周范围和主题响应布局', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let fail = true, saved: any = null;
  await page.route('**/api/v1/me', route => route.fulfill({ json: { user: { id: 'report-preview', email: 'preview@example.com', timezone: 'Asia/Shanghai' }, csrf_token: 'test' } }));
  await page.route('**/api/v1/tasks*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/daily-plans*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/settings', route => route.fulfill({ json: { theme: 'light' } }));
  await page.route('**/api/v1/statistics?*', route => route.fulfill({ json: { start: day, end: day, daily: [], completed: [], scopes: {}, completion_priorities: {}, summary: { completed_tasks: 0, created_tasks: 0, focus_seconds: 0 }, previous: { completed_tasks: 0, created_tasks: 0, focus_seconds: 0 } } }));
  await page.route('**/api/v1/period-reports/schedule', route => route.fulfill({ json: { weekly_enabled: true, monthly_enabled: true, version: 1, time: '09:00', timezone: 'Asia/Shanghai' } }));
  await page.route('**/api/v1/period-reports?*', route => route.fulfill({ json: { items: saved ? [{ ...saved, summary: saved.content.summary }] : [], has_more: false } }));
  await page.route('**/api/v1/period-reports', route => {
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { detail: '数据服务暂时不可用，请稍后重试' } }); }
    const body = route.request().postDataJSON();
    const daily = Array.from({ length: 7 }, (_, i) => ({ date: '2026-09-' + (21 + i), completed: [3, 1, 4, 0, 2, 2, 1][i], created: [2, 2, 1, 3, 1, 0, 0][i], focus_seconds: [3000, 1500, 4200, 0, 3600, 900, 1800][i] }));
    saved = { id: 'preview-report', kind: body.kind, start: '2026-09-21', end: '2026-09-27', generated_at: '2026-09-28T01:00:00Z', source: 'auto', partial: false, timezone: 'Asia/Shanghai', content: {
      summary: { completed_tasks: 12, completion_events: 13, created_tasks: 9, focus_seconds: 15000 }, previous: { completed_tasks: 8, created_tasks: 11, focus_seconds: 10800, start: '2026-09-14', end: '2026-09-20' }, daily, scopes: { work: 7, life: 2, study: 4 }, completion_priorities: {},
      completed: Array.from({ length: 12 }, (_, i) => ({ event_id: 'e' + i, task_id: 't' + i, title: ['完成产品需求评审', '整理英语学习笔记', '提交季度项目计划'][i % 3] + ' ' + (i + 1), scope: ['work', 'study', 'life'][i % 3], priority: 'mid', date: '2026-09-21', occurred_at: '2026-09-21T03:00:00Z' })), active_days: 6,
      insights: ['完成 12 项任务，新增 9 项，累计专注 250 分钟；有活动记录的日期共 6 天。', '比上一周，完成任务数增加 4 项。', '完成最多的一天是 2026-09-23（4 次）；完成记录主要来自工作（7 次）。'], advice: '生成时有 2 项未完成任务的截止日期不晚于报告期末，建议先处理高优先级事项，再为其余事项重新安排时间。', carryover: [{ task_id: 'next1', title: '确认下阶段的研发排期', priority: 'high', due: '2026-09-26' }, { task_id: 'next2', title: '完成读书笔记', priority: 'mid', due: '2026-09-27' }],
    } };
    return route.fulfill({ status: 201, json: saved });
  });
  await page.goto('/stats'); await page.getByRole('button', { name: '周报与月报', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成周报', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '生成周报', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('数据服务暂时不可用');
  await page.getByRole('button', { name: '生成周报', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本期复盘', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: '报告专注时长图', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: '报告完成分类图', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看更多完成事项', exact: true }).click();
  await expect(page.locator('.report-task-section').first().locator('.report-task')).toHaveCount(12);
  await page.screenshot({ path: info.outputPath('period-reports-light.png'), fullPage: true });
  await page.evaluate(async () => { const modulePath = '/src/themes.ts'; const themes = await import(modulePath); themes.applyTheme('dark'); });
  await page.screenshot({ path: info.outputPath('period-reports-dark.png'), fullPage: true });
  await page.evaluate(async () => { const modulePath = '/src/themes.ts'; const themes = await import(modulePath); themes.applyTheme('warm'); });
  await page.screenshot({ path: info.outputPath('period-reports-warm.png'), fullPage: true });
  await page.getByRole('group', { name: '报告类型', exact: true }).getByRole('button', { name: '月报', exact: true }).click();
  await page.getByLabel('报告月份', { exact: true }).fill('2024-02');
  await expect(page.locator('.report-range')).toContainText('2024-02-01 至 2024-02-29');
  await page.getByRole('group', { name: '报告类型', exact: true }).getByRole('button', { name: '周报', exact: true }).click();
  await page.getByLabel('报告日期', { exact: true }).fill('2025-01-01');
  await expect(page.locator('.report-range')).toContainText('2024-12-30 至 2025-01-05');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
