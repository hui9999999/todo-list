import { test, expect } from '@playwright/test';

test('任务日历主题、快捷日期、月份切换和时区保存', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-04T01:00:00Z') });
  const created: any[] = [];
  await page.route('**/api/v1/**', route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/me')) return route.fulfill({ json: { user: { id: 'calendar-test', timezone: 'Asia/Shanghai' }, csrf_token: 'test' } });
    if (pathname.endsWith('/settings')) return route.fulfill({ json: { theme: 'warm', weather_enabled: false, notifications_enabled: false } });
    if (pathname.endsWith('/classify')) return route.fulfill({ json: { scope: 'life' } });
    if (pathname === '/api/v1/tasks' && request.method() === 'POST') {
      created.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { ...created.at(-1), id: 'calendar-task', version: 1, deleted_at: null } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const deadline = page.getByLabel('截止时刻', { exact: true });
  await expect(deadline).toHaveValue('2026-10-04 23:59');
  await page.getByLabel('任务名称', { exact: true }).fill('整理阅读计划');
  for (const theme of ['warm', 'light', 'dark']) {
    await page.evaluate(async value => { const path = '/src/themes.ts'; (await import(path)).applyTheme(value); }, theme);
    // Constrain both sides of the input, reproducing a scrolled drawer on a small screen.
    await deadline.evaluate(el => {
      const body = el.closest('.el-drawer__body')!;
      body.scrollTop += el.getBoundingClientRect().top - innerHeight / 2;
    });
    await deadline.click();
    const calendar = page.locator('.task-deadline-calendar:visible');
    await expect(calendar.getByRole('button', { name: '明天', exact: true })).toBeVisible();
    await expect(calendar.locator('.el-date-picker__header')).toContainText('2026');
    // The drawer and popover animate on entry; inspect their settled position.
    await expect.poll(async () => {
      const bounds = await calendar.boundingBox(), viewport = page.viewportSize()!;
      return !!bounds && bounds.x >= 0 && bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height;
    }).toBe(true);
    await page.screenshot({ path: info.outputPath(`task-calendar-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
  await deadline.click();
  await page.locator('.task-deadline-calendar:visible').getByRole('button', { name: '明天', exact: true }).click();
  await expect(deadline).toHaveValue('2026-10-05 23:59');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0].due_at).toBe('2026-10-05T15:59:00.000Z');
  expect(created[0].due_timezone).toBe('Asia/Shanghai');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByText('某一天', { exact: true }).click();
  await page.getByLabel('截止日期', { exact: true }).click();
  await page.locator('.task-deadline-calendar:visible').getByRole('button', { name: '一周后', exact: true }).click();
  await expect(page.getByLabel('截止日期', { exact: true })).toHaveValue('2026-10-11');
});
