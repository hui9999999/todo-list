import { test, expect } from '@playwright/test';

test('AI 聊天创建、修改、删除任务，预览确认后刷新并支持撤销', async ({ page }) => {
  await page.route('**/api/v1/me', route => route.fulfill({ json: { user: { id: 'ai-user', email: 'ai@example.com', timezone: 'Asia/Shanghai' }, csrf_token: 'test' } }));
  await page.route('**/api/v1/settings', route => route.fulfill({ json: { theme: 'light' } }));
  await page.route('**/api/v1/projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/daily-plans*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/model-preferences', route => route.fulfill({ json: { model: 'chat-json-model' } }));
  const task = { id: 'milk', title: '买牛奶', notes: '原备注', scope: 'life', status: 'todo', priority: 'mid', parent_id: null, project_id: null, hidden: false, fail_reason: '', due_date: null, due_at: '2026-10-01T15:59:00Z', due_timezone: 'Asia/Shanghai', version: 1, deleted_at: null as string|null };
  let exists = false, refreshes = 0, run: any = null, proposal: any = null;
  const messages: any[] = [], requests: string[] = [], confirmed: string[] = [];
  await page.route('**/api/v1/tasks*', route => { refreshes++; return route.fulfill({ json: exists && !task.deleted_at ? [task] : [] }); });
  await page.route('**/api/v1/conversations**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/conversations') return route.fulfill({ json: route.request().method() === 'POST' ? { id: 'task-chat', title: '任务管理' } : [{ id: 'task-chat', title: '任务管理' }] });
    if (route.request().method() === 'POST') {
      const content = route.request().postDataJSON().content;
      requests.push(content); messages.push({ id: `user-${requests.length}`, role: 'user', content });
      const kind = requests.length === 1 ? 'create' : requests.length === 2 ? 'update' : 'trash';
      proposal = { id: kind, version: 1, state: 'pending', reason: '请核对任务操作。', before: kind === 'create' ? [] : [{ ...task }], actions: [{ kind, task_id: kind === 'create' ? undefined : task.id, version: task.version, fields: kind === 'trash' ? undefined : { ...task, priority: kind === 'update' ? 'high' : 'mid' } }], result: [], undone: false, expires_at: '2026-10-01T16:30:00Z' };
      run = { id: 'crud-run', status: 'awaiting_confirmation', proposals: [proposal] };
      return route.fulfill({ status: 202, json: run });
    }
    return route.fulfill({ json: { messages, runs: run ? [run] : [] } });
  });
  await page.route('**/api/v1/agent-runs/crud-run', route => route.fulfill({ json: run }));
  await page.route('**/api/v1/agent-runs/crud-run/events?after=*', route => route.fulfill({ contentType: 'text/event-stream', body: 'id: 1\nevent: done\ndata: {"status":"awaiting_confirmation"}\n\n' }));
  await page.route('**/api/v1/action-proposals/*/confirm', route => {
    expect(route.request().postDataJSON()).toEqual({ version: 1 });
    confirmed.push(proposal.id); proposal.state = 'accepted'; proposal.result = [{ task_id: task.id, version: ++task.version }]; run.status = 'completed';
    if (proposal.id === 'create') exists = true;
    if (proposal.id === 'update') task.priority = 'high';
    if (proposal.id === 'trash') task.deleted_at = '2026-10-01T12:00:00Z';
    return route.fulfill({ json: proposal });
  });
  await page.route('**/api/v1/actions/trash/undo', route => { task.deleted_at = null; proposal.undone = true; return route.fulfill({ json: proposal }); });
  await page.goto('/ai');
  const input = page.getByRole('textbox', { name: '发给 AI 的消息', exact: true });
  await expect(input).toBeVisible();
  const menu=page.getByRole('button',{name:'任务快捷操作',exact:true});
  const controls=await menu.isVisible()?page.locator('.ai-mobile-menu'):page.getByRole('group',{name:'AI 任务操作'});
  async function openActions(){if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();}
  async function closeActions(){if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')==='true')await menu.click();}
  await openActions();
  await controls.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(input).toHaveValue('创建任务：任务名称');
  await expect(input).toBeFocused();
  expect(await input.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('任务名称');
  await input.fill('创建任务买牛奶'); await input.press('Enter');
  const preview = page.getByRole('region', { name: '任务操作预览' });
  await expect(preview.getByText('请核对任务操作。', {exact:true})).toBeVisible();
  await expect(preview.getByText('买牛奶', { exact: true })).toBeVisible();
  await expect(preview.getByText('2026-10-01 23:59（Asia/Shanghai）', { exact: true })).toBeVisible();
  await openActions();await expect(controls.getByRole('button', { name: '创建任务', exact: true })).toBeDisabled();await closeActions();
  expect(exists).toBe(false);
  await preview.getByRole('button', { name: '确认这些变更' }).click();
  await expect(preview.getByRole('button', { name: '撤销本次操作' })).toBeVisible();
  expect(exists).toBe(true);
  await openActions();await controls.getByRole('button', { name: '修改任务', exact: true }).click();
  await input.fill('将买牛奶的优先级改为高'); await input.press('Enter');
  const priority = preview.locator('dl').filter({ hasText: '优先级' });
  await expect(priority).toHaveText('优先级中 → 高');
  await expect(preview.locator('dl').filter({ hasText: '备注' })).toHaveCount(0);
  expect(task.priority).toBe('mid');
  await preview.getByRole('button', { name: '确认这些变更' }).click();
  await openActions();await expect(controls.getByRole('button', { name: '删除任务', exact: true })).toBeEnabled();
  expect(task.priority).toBe('high');
  await controls.getByRole('button', { name: '删除任务', exact: true }).click();
  await input.fill('删除任务买牛奶'); await input.press('Enter');
  await expect(preview.getByText('移入垃圾站，可恢复。该任务的子任务也会一起移入。', { exact: true })).toBeVisible();
  expect(task.deleted_at).toBeNull();
  await preview.getByRole('button', { name: '确认这些变更' }).click();
  await expect(preview.getByRole('button', { name: '撤销本次操作' })).toBeVisible();
  expect(task.deleted_at).not.toBeNull();
  await preview.getByRole('button', { name: '撤销本次操作' }).click();
  await expect(preview.getByText('本次操作已撤销。', { exact: true })).toBeVisible();
  expect(task.deleted_at).toBeNull();
  expect(confirmed).toEqual(['create', 'update', 'trash']);
  expect(refreshes).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
