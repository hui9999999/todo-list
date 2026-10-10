import { test, expect } from '@playwright/test';

test('快速切换任务详情后，迟到的请求不会覆盖当前任务的依赖', async ({ page }) => {
  const row = { notes: '', scope: 'work', priority: 'mid', status: 'todo', hidden: false, parent_id: null, version: 1, due_at: null, due_date: null, due_timezone: null, deleted_at: null, created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' };
  const rows = [{ ...row, id: 'task-a', title: '第一项任务' }, { ...row, id: 'task-b', title: '第二项任务' }, { ...row, id: 'prerequisite', title: '前置准备' }];
  let releaseFirst!: () => void, firstStarted = false, secondLoaded = false;
  const delayFirst = new Promise<void>(resolve => { releaseFirst = resolve; });
  await page.route('**/api/v1/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/me')) return route.fulfill({ json: { user: { id: 'editor-race', timezone: 'Asia/Shanghai' }, csrf_token: 'test' } });
    if (pathname.endsWith('/settings')) return route.fulfill({ json: { theme: 'light', notifications_enabled: false, weather_enabled: false } });
    if (pathname === '/api/v1/tasks') return route.fulfill({ json: new URL(route.request().url()).searchParams.has('trash') ? [] : rows });
    if (pathname.endsWith('/tasks/task-a/dependencies')) {
      firstStarted = true;
      await delayFirst;
      return route.fulfill({ json: [{ id: 'dependency-a', depends_on_id: 'prerequisite' }] });
    }
    if (pathname.endsWith('/tasks/task-b/dependencies')) secondLoaded = true;
    return route.fulfill({ json: [] });
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: '第一项任务', exact: true }).click();
  await expect.poll(() => firstStarted).toBe(true);
  const drawer = page.getByRole('dialog', { name: '任务详情', exact: true });
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: '第二项任务', exact: true }).click();
  await expect.poll(() => secondLoaded).toBe(true);
  await expect(drawer.getByLabel('任务名称', { exact: true })).toHaveValue('第二项任务');
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/tasks/task-a/dependencies'));
  releaseFirst();
  await (await lateResponse).finished();
  await drawer.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(drawer.getByRole('button', { name: '解除', exact: true })).toHaveCount(0);
});

test('依赖操作尚未返回时切换任务，不会改写另一项任务的版本', async ({ page }) => {
  const row = { notes: '', scope: 'work', priority: 'mid', status: 'todo', hidden: false, parent_id: null, version: 1, due_at: null, due_date: null, due_timezone: null, deleted_at: null, created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' };
  const rows = [{ ...row, id: 'task-a', title: '第一项任务' }, { ...row, id: 'task-b', title: '第二项任务' }, { ...row, id: 'prerequisite', title: '前置准备' }];
  let releaseMutation!: () => void, mutationStarted = false;
  const delayMutation = new Promise<void>(resolve => { releaseMutation = resolve; });
  let savedVersion: number | undefined;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
    if (pathname.endsWith('/me')) return route.fulfill({ json: { user: { id: 'editor-mutation', timezone: 'Asia/Shanghai' }, csrf_token: 'test' } });
    if (pathname.endsWith('/settings')) return route.fulfill({ json: { theme: 'light', notifications_enabled: false, weather_enabled: false } });
    if (pathname === '/api/v1/tasks') return route.fulfill({ json: url.searchParams.has('trash') ? [] : rows });
    if (pathname.endsWith('/tasks/task-a/dependencies') && request.method() === 'POST') {
      mutationStarted = true;
      await delayMutation;
      return route.fulfill({ json: { version: 2 } });
    }
    if (pathname.endsWith('/tasks/task-b') && request.method() === 'PUT') {
      const fields = request.postDataJSON(); savedVersion = fields.version;
      return route.fulfill({ json: { ...rows[1], ...fields, version: 2 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: '第一项任务', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '任务详情', exact: true });
  await drawer.getByRole('combobox', { name: '添加依赖', exact: true }).click();
  await page.getByRole('option', { name: '前置准备', exact: true }).click();
  await drawer.getByRole('button', { name: '添加依赖', exact: true }).click();
  await expect.poll(() => mutationStarted).toBe(true);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: '第二项任务', exact: true }).click();
  await expect(drawer.getByLabel('任务名称', { exact: true })).toHaveValue('第二项任务');
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/tasks/task-a/dependencies') && response.request().method() === 'POST');
  releaseMutation();
  await (await lateResponse).finished();
  await drawer.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await drawer.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => savedVersion).toBe(1);
});
