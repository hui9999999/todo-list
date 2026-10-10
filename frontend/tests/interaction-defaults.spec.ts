import { test, expect, type Page } from '@playwright/test';
import { recordTask } from './task-entry';

test.use({ timezoneId: 'UTC' });

async function mockWorkspace(page: Page, timezone = 'Asia/Shanghai') {
  await page.route('**/api/v1/me', route => route.fulfill({ json: { user: { id: 'interaction-test', email: 'interaction@example.com', timezone }, csrf_token: 'test' } }));
  await page.route('**/api/v1/settings', route => route.fulfill({ json: { theme: 'light' } }));
  await page.route('**/api/v1/projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/daily-plans*', route => route.fulfill({ json: [] }));
}

test('Enter 发送，Shift Enter 换行，中文输入法和重复回车不误发', async ({ page }, info) => {
  await mockWorkspace(page);
  await page.route('**/api/v1/tasks*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/model-preferences', route => route.fulfill({ json: null }));
  const requests: string[] = [], messages: { id: string; role: string; content: string }[] = [];
  let sent = false;
  const run = { id: 'keyboard-run', status: 'running', proposals: [] };
  await page.route('**/api/v1/conversations**', route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname.endsWith('/classify')) return route.fulfill({ json: { scope: 'unassigned' } });
    if (url.pathname === '/api/v1/conversations') return route.fulfill({ json: method === 'POST' ? { id: 'keyboard-chat', title: '回车测试' } : [{ id: 'keyboard-chat', title: '回车测试' }] });
    if (method === 'POST') {
      const content = route.request().postDataJSON().content;
      requests.push(content); messages.push({ id: 'keyboard-message', role: 'user', content }); sent = true;
      return route.fulfill({ json: run });
    }
    return route.fulfill({ json: { messages, runs: sent ? [run] : [] } });
  });
  await page.route('**/api/v1/agent-runs/keyboard-run', route => route.fulfill({ json: run }));
  await page.route('**/api/v1/agent-runs/keyboard-run/events?after=*', route => route.fulfill({ contentType: 'text/event-stream', body: 'id: 1\nevent: answer_delta\ndata: {"text":"正在处理回车消息"}\n\n' }));
  await page.goto('/ai');
  const input = page.getByRole('textbox', { name: '发给 AI 的消息', exact: true });
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await input.press('Enter');
  expect(requests).toEqual([]);
  await input.fill('第一行');
  await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  expect(requests).toEqual([]);
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 });
  expect(requests).toEqual([]);
  await input.press('Enter');
  await expect(page.getByText('正在处理回车消息', { exact: true })).toBeVisible();
  expect(requests).toEqual(['第一行\n第二行']);
  await expect(input).toHaveValue('');
  await input.fill('等待期间不重复发送');
  await input.press('Enter');
  await expect(input).toHaveValue('等待期间不重复发送');
  expect(requests).toHaveLength(1);
  const hint=page.getByText('Enter 发送 · Shift + Enter 换行', { exact: true });
  if(info.project.name==='mobile')await expect(hint).toBeHidden();
  else await expect(hint).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('快速添加、任务抽屉和子任务默认账户当天23:59，保留手动选择', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T01:00:00Z') });
  await mockWorkspace(page, 'America/Los_Angeles');
  const rows: any[] = [], creations: any[] = [];
  await page.route('**/api/v1/tasks**', route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname.endsWith('/classify')) return route.fulfill({ json: { scope: 'unassigned' } });
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/dependencies') || url.searchParams.has('trash')) return route.fulfill({ json: [] });
    if (method === 'POST') {
      const fields = route.request().postDataJSON(); creations.push(fields);
      const row = { ...fields, id: `deadline-task-${rows.length}`, version: 1, deleted_at: null, completed_at: null, created_at: '2026-10-01T01:00:00Z', updated_at: '2026-10-01T01:00:00Z' };
      rows.push(row); return route.fulfill({ status: 201, json: row });
    }
    if (method === 'PUT') {
      const fields = route.request().postDataJSON(), row = rows.find(row => url.pathname.endsWith('/' + row.id));
      Object.assign(row, fields, { version: row.version + 1 }); return route.fulfill({ json: row });
    }
    return route.fulfill({ json: rows });
  });
  await page.goto('/tasks?period=year');
  await recordTask(page, '快速默认截止');
  await expect(page.getByRole('button', { name: '快速默认截止', exact: true })).toBeVisible();
  expect(creations[0].due_at).toBe('2026-10-01T06:59:00.000Z');
  expect(creations[0].due_timezone).toBe('America/Los_Angeles');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await expect(page.getByLabel('截止时刻', { exact: true })).toHaveValue('2026-09-30 23:59');
  await expect(page.getByText('按账户时区 America/Los_Angeles 输入和显示。', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '任务名称', exact: true }).fill('手动不设截止');
  await page.getByText('不设截止', { exact: true }).click();
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '手动不设截止', exact: true })).toBeVisible();
  expect(creations[1].due_at).toBeNull();
  expect(creations[1].due_date).toBeNull();
  await page.getByRole('button', { name: '手动不设截止', exact: true }).click();
  await expect(page.getByRole('radio', { name: '不设截止', exact: true })).toBeChecked();
  await page.getByRole('textbox', { name: '任务名称', exact: true }).fill('改名保留不设截止');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '改名保留不设截止', exact: true })).toBeVisible();
  expect(rows[1].due_at).toBeNull();
  await page.locator('.task-row').filter({ hasText: '快速默认截止' }).getByRole('button', { name: '任务更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加子任务', exact: true }).click();
  await expect(page.getByLabel('截止时刻', { exact: true })).toHaveValue('2026-09-30 23:59');
  await page.getByRole('textbox', { name: '任务名称', exact: true }).fill('默认子任务');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '默认子任务', exact: true })).toBeVisible();
  expect(creations[2].due_at).toBe(creations[0].due_at);
  expect(creations[2].parent_id).toBe(rows[0].id);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('textbox', { name: '任务名称', exact: true }).fill('手动截止时刻');
  await page.getByLabel('截止时刻', { exact: true }).fill('2026-03-08 02:30');
  await page.getByLabel('截止时刻', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByText('该时刻在账户时区中不存在，请选择其他时间。', { exact: true })).toBeVisible();
  expect(creations).toHaveLength(3);
  await page.getByLabel('截止时刻', { exact: true }).fill('2026-10-02 10:30');
  await page.getByLabel('截止时刻', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '手动截止时刻', exact: true })).toBeVisible();
  expect(creations[3].due_at).toBe('2026-10-02T17:30:00.000Z');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
