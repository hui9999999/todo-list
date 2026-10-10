import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function account(page: Page) {
  const origin = 'http://localhost:5174', email = `browser-export-${randomUUID()}@example.com`, password = 'export-test-password';
  expect((await page.request.post('/api/v1/auth/register', { headers: { Origin: origin }, data: { email, password } })).status()).toBe(201);
  const response = await page.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { email, password } });
  expect(response.status()).toBe(200);
  return { Origin: origin, 'X-CSRF-Token': (await response.json()).csrf_token };
}

test('数据管理导出范围、四种格式、垃圾站和个人账户入口', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const headers = await account(page);
  for (const data of [{ title: '学习导出任务', scope: 'study', due_date: '2026-10-02', notes: '学习备注' }, { title: '旧日期工作任务', scope: 'work', due_date: '2026-09-15' }]) {
    expect((await page.request.post('/api/v1/tasks', { headers, data })).status()).toBe(201);
  }
  const trash = await (await page.request.post('/api/v1/tasks', { headers, data: { title: '待恢复学习任务', scope: 'study', due_date: '2026-10-02' } })).json();
  expect((await page.request.post(`/api/v1/tasks/${trash.id}/trash`, { headers, data: { version: trash.version } })).status()).toBe(200);
  await page.goto('/data');
  const nav = page.getByRole('navigation', { name: '工作区', exact: true });
  await expect(nav.getByRole('link', { name: /垃圾站|设置/ })).toHaveCount(0);
  const preview = page.getByLabel('导出范围预览');
  await expect(preview.locator('.export-preview-heading strong')).toContainText('2');
  await page.getByRole('combobox', { name: '导出时间依据', exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: '截止时间', exact: true }).click();
  await page.getByRole('textbox', { name: '导出开始日期', exact: true }).fill('2026-10-02');
  await page.getByRole('textbox', { name: '导出结束日期', exact: true }).fill('2026-10-02');
  await page.getByRole('combobox', { name: '导出任务分类', exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: '学习', exact: true }).click();
  await expect(preview.locator('.export-preview-heading strong')).toContainText('1');
  await page.getByText('包含垃圾站任务', { exact: true }).click();
  await expect(preview.locator('.export-preview-heading strong')).toContainText('2');
  await page.getByText('包含垃圾站任务', { exact: true }).click();
  await expect(preview.locator('.export-preview-heading strong')).toContainText('1');
  for (const [extension, label, name] of [['xlsx', 'Excel (.xlsx)', 'Excel'], ['pdf', 'PDF (.pdf)', 'PDF'], ['docx', 'Word (.docx)', 'Word'], ['csv', 'CSV (.csv)', 'CSV']]) {
    if (extension !== 'xlsx') {
      await page.getByRole('combobox', { name: '导出文件格式', exact: true }).press('ArrowDown');
      await page.getByRole('option', { name: label, exact: true }).click();
    }
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 ' + name, exact: true }).click();
    const download = await event;
    expect(download.suggestedFilename()).toMatch(new RegExp('\\.' + extension + '$'));
    expect(await download.failure()).toBeNull();
    await download.saveAs(info.outputPath('filtered-report.' + extension));
  }
  await page.screenshot({ path: info.outputPath('export-panel.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('textbox', { name: '导出开始日期', exact: true }).fill('2026-10-03');
  await expect(page.locator('.export-panel').getByRole('alert')).toContainText('结束日期不能早于开始日期');
  await expect(page.getByRole('button', { name: '导出 CSV', exact: true })).toBeDisabled();

  const tabs = page.getByRole('navigation', { name: '数据管理项目', exact: true });
  await tabs.getByRole('link', { name: /垃圾站/ }).click();
  await expect(page.locator('.task-row')).toContainText('待恢复学习任务');
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await tabs.getByRole('link', { name: '备份与导入', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出 2.0 备份', exact: true })).toBeVisible();
  await page.locator(info.project.name === 'mobile' ? '.mobile-account' : '.account-link').click();
  await expect(page.getByRole('heading', { name: '个人账户', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('account-settings.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/trash');
  await expect(page).toHaveURL(/\/data\?tab=trash$/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/account$/);
  expect(errors).toEqual([]);
});
