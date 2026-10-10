import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Task } from '../src/types';
import { fieldsOf } from '../src/stores/tasks';
import { settingKeys } from '../src/themes';

const origin = 'http://localhost:5174';
async function account(page: Page) {
  const response = await page.request.post('/api/v1/auth/register', {headers: {Origin: origin}, data: {
    email: `browser-workflow-${randomUUID()}@example.com`, password: 'workflow-test-password', timezone: 'Asia/Shanghai',
  }});
  expect(response.status()).toBe(201);
  const headers = {Origin: origin, 'X-CSRF-Token': (await response.json()).csrf_token};
  const settings = await (await page.request.get('/api/v1/settings')).json();
  const fields = Object.fromEntries(settingKeys.map(key => [key, settings[key]]));
  expect((await page.request.put('/api/v1/settings', {headers, data: {...fields, notifications_enabled: false, weather_enabled: false, news_enabled: false, suggestions_enabled: false}})).status()).toBe(200);
  return headers;
}
async function create(page: Page, headers: Record<string, string>, fields: object): Promise<Task> {
  const response = await page.request.post('/api/v1/tasks', {headers, data: {due_at: null, due_date: null, ...fields}});
  expect(response.status()).toBe(201);
  return response.json();
}
const card = (page: Page, id: string) => page.locator(`[data-task-id="${id}"]`);
async function revealActions(page:Page,id:string){
  const row=card(page,id);
  if(!await row.locator('.task-card-actions').isVisible())await row.getByRole('button',{name:/^展开任务信息/}).click();
}
async function allStates(page: Page) {
  await page.getByRole('combobox', {name: '筛选状态'}).press('ArrowDown');
  await page.getByRole('option', {name: '全部状态', exact: true}).click();
}
async function statusMenu(page: Page, id: string, action: string) {
  await card(page, id).getByRole('button', {name: '任务更多操作'}).click();
  await page.getByRole('menuitem', {name: action, exact: true}).click();
}

test('开始、失败原因、重试与历史，逾期不自动失败', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const headers = await account(page);
  const task = await create(page, headers, {title: '申请资格', due_date: '2020-01-01'});
  await page.goto('/tasks');
  await expect(card(page, task.id).locator('.task-countdown')).toContainText('已逾期');
  expect((await (await page.request.get('/api/v1/tasks/' + task.id)).json()).status).toBe('todo');
  await revealActions(page,task.id);
  await card(page, task.id).getByRole('button', {name: '开始', exact: true}).click();
  await expect(card(page, task.id).locator('.task-meta')).toContainText('进行中');
  await statusMenu(page, task.id, '标记失败');
  const dialog = page.getByRole('dialog', {name: '标记任务失败', exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', {name: '失败原因', exact: true}).fill('  ');
  await dialog.getByRole('button', {name: '确认标记失败', exact: true}).click();
  await expect(page.getByText('请填写失败原因', {exact: true})).toBeVisible();
  expect((await (await page.request.get('/api/v1/tasks/' + task.id)).json()).status).toBe('doing');
  await dialog.getByRole('button', {name: '申请或审核未通过', exact: true}).click();
  await dialog.getByRole('button', {name: '确认标记失败', exact: true}).click();
  await expect(dialog).toBeHidden();
  await allStates(page);
  await expect(card(page, task.id).locator('.task-countdown')).toHaveText('已失败');
  await expect(card(page, task.id).getByRole('button', {name: '完成：申请资格', exact: true})).toHaveCount(0);
  await card(page, task.id).getByRole('button', {name: '申请资格', exact: true}).click();
  const drawer = page.getByRole('dialog', {name: '任务详情', exact: true});
  await expect(drawer).toContainText('先保存为待办或进行中，再标记完成');
  await expect(drawer.locator('.history')).toContainText('失败原因：申请或审核未通过');
  await drawer.getByRole('button', {name: '关闭', exact: true}).click();
  await revealActions(page,task.id);
  await card(page, task.id).getByRole('button', {name: '重新尝试', exact: true}).click();
  await expect(card(page, task.id).getByRole('button', {name: '开始', exact: true})).toBeVisible();
  const retried = await (await page.request.get('/api/v1/tasks/' + task.id)).json();
  expect(retried.status).toBe('todo'); expect(retried.fail_reason).toBe('');
  await card(page, task.id).getByRole('button', {name: '申请资格', exact: true}).click();
  await expect(drawer.locator('.history')).toContainText('此前失败原因：申请或审核未通过');
  expect(errors).toEqual([]);
  await page.screenshot({path: info.outputPath('failure-history.png'), fullPage: true});
});

for (const outcome of ['done', 'failed', 'cancelled'] as const) {
  test(`失败子任务保留结果，父任务选择 ${outcome}`, async ({page}, info) => {
    const headers = await account(page);
    const parent = await create(page, headers, {title: '整体申请'});
    const child = await create(page, headers, {title: '附加资格审核', parent_id: parent.id, status: 'failed', fail_reason: '审核未通过'});
    await page.goto('/tasks');
    await card(page, parent.id).getByRole('button', {name: '完成：整体申请', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '选择父任务结果', exact: true});
    await expect(dialog).toContainText('附加资格审核');
    await expect(dialog).toContainText('审核未通过');
    expect((await (await page.request.get('/api/v1/tasks/' + parent.id)).json()).status).toBe('todo');
    const label = {done: '整体目标已完成', failed: '整体未达成', cancelled: '不再执行'}[outcome];
    await dialog.getByText(label, {exact: true}).click();
    await expect(dialog.getByRole('radio', {name: label, exact: true})).toBeChecked();
    if (outcome === 'failed') await dialog.getByRole('textbox', {name: '失败原因', exact: true}).fill('整体条件未满足');
    await page.screenshot({path: info.outputPath(`parent-${outcome}.png`), fullPage: true});
    await dialog.getByRole('button', {name: '确认结果', exact: true}).click();
    await expect(dialog).toBeHidden();
    await allStates(page);
    await expect(card(page, parent.id).locator('.task-countdown')).toHaveText({done: '已完成', failed: '已失败', cancelled: '已取消'}[outcome]);
    expect((await (await page.request.get('/api/v1/tasks/' + child.id)).json()).status).toBe('failed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('必要依赖失败时显示受阻，解除后恢复开始和完成', async ({page}, info) => {
  const headers = await account(page);
  const prerequisite = await create(page, headers, {title: '必要审核', status: 'failed', fail_reason: '缺少资格'});
  const task = await create(page, headers, {title: '正式发布'});
  expect((await page.request.post(`/api/v1/tasks/${task.id}/dependencies`, {headers, data: {version: task.version, depends_on_id: prerequisite.id}})).status()).toBe(200);
  await page.goto('/tasks');
  await expect(card(page, task.id).locator('.task-blocked')).toContainText('“必要审核”失败，需重试或解除依赖');
  await expect(card(page, task.id).getByRole('button', {name: '开始', exact: true})).toBeDisabled();
  await card(page, task.id).getByRole('button', {name: '完成：正式发布', exact: true}).click();
  await expect(page.getByText('依赖任务“必要审核”失败，请重试或解除依赖', {exact: true})).toBeVisible();
  await card(page, task.id).getByRole('button', {name: '正式发布', exact: true}).click();
  const drawer = page.getByRole('dialog', {name: '任务详情', exact: true});
  await expect(drawer.locator('.task-blocked')).toContainText('缺少资格');
  await page.screenshot({path: info.outputPath('blocked-task.png'), fullPage: true});
  await drawer.getByRole('button', {name: '解除', exact: true}).click();
  await expect(drawer.locator('.task-blocked')).toHaveCount(0);
  await drawer.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(card(page, task.id).getByRole('button', {name: '开始', exact: true})).toBeEnabled();
  await card(page, task.id).getByRole('button', {name: '完成：正式发布', exact: true}).click();
  await expect(card(page, task.id)).toHaveCount(0);
});

test('取消任务需要明确操作，之后可以重新打开', async ({page}) => {
  const headers = await account(page);
  const task = await create(page, headers, {title: '取消的安排'});
  await page.goto('/tasks');
  await statusMenu(page, task.id, '取消任务');
  await page.getByRole('button', {name: '返回', exact: true}).click();
  expect((await (await page.request.get('/api/v1/tasks/' + task.id)).json()).status).toBe('todo');
  await statusMenu(page, task.id, '取消任务');
  await page.getByRole('button', {name: '确认取消任务', exact: true}).click();
  await allStates(page);
  await expect(card(page, task.id).locator('.task-countdown')).toHaveText('已取消');
  await expect(card(page, task.id).getByRole('button', {name: '完成：取消的安排', exact: true})).toHaveCount(0);
  await revealActions(page,task.id);
  await card(page, task.id).getByRole('button', {name: '重新打开', exact: true}).click();
  await expect(card(page, task.id).getByRole('button', {name: '开始', exact: true})).toBeVisible();
});

test('编辑器标记失败必须说明原因', async ({page}) => {
  const headers = await account(page);
  const task = await create(page, headers, {title: '编辑器失败校验'});
  await page.goto('/tasks');
  await card(page, task.id).getByRole('button', {name: task.title, exact: true}).click();
  const drawer = page.getByRole('dialog', {name: '任务详情', exact: true});
  await drawer.getByRole('combobox', {name: '任务状态', exact: true}).press('ArrowDown');
  await page.getByRole('option', {name: '失败', exact: true}).click();
  await drawer.getByRole('textbox', {name: '失败原因', exact: true}).fill(' ');
  await drawer.getByRole('button', {name: '保存修改', exact: true}).click();
  await expect(page.getByText('请填写失败原因', {exact: true})).toBeVisible();
  await drawer.getByRole('button', {name: '执行出错', exact: true}).click();
  await drawer.getByRole('button', {name: '保存修改', exact: true}).click();
  await expect(drawer).toBeHidden();
  const current = await (await page.request.get('/api/v1/tasks/' + task.id)).json();
  expect(current.status).toBe('failed'); expect(current.fail_reason).toBe('执行出错');
});

test('父任务确认期间子任务被修改，会阻止过期确认', async ({page}) => {
  const headers = await account(page);
  const parent = await create(page, headers, {title: '并发收尾'});
  const child = await create(page, headers, {title: '失败子任务', parent_id: parent.id, status: 'failed', fail_reason: '未通过'});
  await page.goto('/tasks');
  await card(page, parent.id).getByRole('button', {name: '完成：并发收尾', exact: true}).click();
  const response = await page.request.put('/api/v1/tasks/' + child.id, {headers, data: {...fieldsOf(child), version: child.version, fail_reason: '最新结果仍未通过'}});
  expect(response.status()).toBe(200);
  await page.getByRole('dialog', {name: '选择父任务结果', exact: true}).getByRole('button', {name: '确认结果', exact: true}).click();
  await expect(page.getByText('子任务包含失败项，请查看最新结果并明确确认父任务整体目标已完成', {exact: true})).toBeVisible();
  await expect(page.getByRole('dialog', {name: '选择父任务结果', exact: true})).toBeHidden();
  expect((await (await page.request.get('/api/v1/tasks/' + parent.id)).json()).status).toBe('todo');
});
