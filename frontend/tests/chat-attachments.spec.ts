import { test, expect, type Page } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=', 'base64');
async function workspace(page: Page, fail = false) {
  await page.route('**/api/v1/me', route => route.fulfill({ json: { user: { id: 'files-user', email: 'files@example.com', timezone: 'Asia/Shanghai' }, csrf_token: 'test' } }));
  await page.route('**/api/v1/settings', route => route.fulfill({ json: { theme: 'light' } }));
  await page.route('**/api/v1/projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/tasks*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/daily-plans*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/model-preferences', route => route.fulfill({ json: { model: 'test-model' } }));
  let chatNumber = 0;
  const requests: any[] = [], messages: any[] = [];
  const run = { id: 'files-run', status: 'completed', proposals: [] };
  await page.route('**/api/v1/conversations**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/conversations') {
      if (route.request().method() === 'POST') {chatNumber++; return route.fulfill({ json: { id: `files-chat-${chatNumber}`, title: '文件对话' } });}
      return route.fulfill({ json: Array.from({ length: chatNumber }, (_, index) => ({ id: `files-chat-${index + 1}`, title: '文件对话' })) });
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); requests.push(body);
      if (fail) return route.fulfill({ status: 422, json: { detail: '附件无法读取，请检查文件内容' } });
      messages.push({ id: `files-message-${requests.length}`, role: 'user', content: body.content, attachments: body.attachments.map((file: any) => ({ name: file.name, size: Buffer.from(file.data, 'base64').length, media_type: 'text/plain', warnings: file.name.endsWith('.pdf') ? ['PDF 共 80 页，只读取前 40 页。'] : [] })) });
      return route.fulfill({ status: 202, json: run });
    }
    return route.fulfill({ json: { messages: path.includes(`files-chat-${chatNumber}`) && chatNumber > 1 ? [] : messages, runs: messages.length && chatNumber === 1 ? [run] : [] } });
  });
  await page.route('**/api/v1/agent-runs/files-run', route => route.fulfill({ json: run }));
  await page.route('**/api/v1/agent-runs/files-run/events?after=*', route => route.fulfill({ contentType: 'text/event-stream', body: 'id: 1\nevent: done\ndata: {"status":"completed"}\n\n' }));
  await page.goto('/ai');
  return requests;
}

test('选择多个文档附件、移除附件并随回车消息发送，历史显示读取范围', async ({ page }) => {
  const requests = await workspace(page);
  const picker = page.locator('#chat-attachments');
  const buffers = [
    { name: '会议.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('word bytes') },
    { name: '资料.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf bytes') },
    { name: '待办.md', mimeType: 'text/markdown', buffer: Buffer.from('# 待办\n- 买牛奶') },
    { name: 'data.json', mimeType: 'application/json', buffer: Buffer.from('{"title":"提交报告"}') },
  ];
  await expect(page.getByRole('button', { name: '添加附件', exact: true })).toBeVisible();
  await picker.setInputFiles(buffers);
  const draft = page.getByRole('list', { name: '待发送附件' });
  await expect(draft.getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
  await page.screenshot({ path: `test-results/chat-attachments-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '移除附件 待办.md', exact: true }).click();
  await expect(draft.getByRole('listitem')).toHaveCount(3);
  const input = page.getByRole('textbox', { name: '发给 AI 的消息', exact: true });
  await input.fill('从附件中提取待办任务'); await input.press('Enter');
  await expect(page.getByRole('list', { name: '消息附件' }).getByRole('listitem')).toHaveCount(3);
  expect(requests).toHaveLength(1);
  expect(requests[0].attachments.map((file: any) => file.name)).toEqual(['会议.docx', '资料.pdf', 'data.json']);
  expect(Buffer.from(requests[0].attachments[0].data, 'base64').toString()).toBe('word bytes');
  await expect(page.getByText('PDF 共 80 页，只读取前 40 页。', { exact: true })).toBeVisible();
  await expect(draft).toHaveCount(0);
  await expect(input).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('粘贴截图和拖入文件，支持仅发送附件，新对话清理未发送附件', async ({ page }) => {
  const requests = await workspace(page);
  const input = page.getByRole('textbox', { name: '发给 AI 的消息', exact: true });
  await input.evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], '截图.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, [...png]);
  await expect(page.getByRole('img', { name: '待发送图片预览' })).toBeVisible();
  await page.getByRole('region', { name: '小狒 AI 助手' }).evaluate(element => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['# 会议记录'], '记录.md', { type: 'text/markdown' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('list', { name: '待发送附件' }).getByRole('listitem')).toHaveCount(2);
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await input.press('Enter');
  await expect(page.getByRole('list', { name: '消息附件' }).getByRole('listitem')).toHaveCount(2);
  expect(requests[0].content).toBe('请阅读这些附件。');
  await expect(page.getByRole('button', { name: '添加附件', exact: true })).toBeEnabled();
  await page.locator('#chat-attachments').setInputFiles({ name: '草稿.md', mimeType: 'text/markdown', buffer: Buffer.from('draft') });
  await expect(page.getByRole('list', { name: '待发送附件' })).toBeVisible();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(page.getByRole('list', { name: '待发送附件' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: '消息附件' })).toHaveCount(0);
});

test('格式、数量与大小限制在发送前提示，不丢失已有附件', async ({ page }) => {
  const requests = await workspace(page);
  const picker = page.locator('#chat-attachments');
  await picker.setInputFiles({ name: '旧文档.doc', mimeType: 'application/msword', buffer: Buffer.from('old') });
  await expect(page.getByText('支持 DOCX、PDF、MD、JSON、TXT、CSV 和 PNG/JPG/WEBP 图片；旧版 DOC 请先转换为 DOCX', { exact: true })).toBeVisible();
  await picker.setInputFiles(Array.from({ length: 6 }, (_, index) => ({ name: `${index}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') })));
  await expect(page.getByText('每条消息最多添加 5 个附件', { exact: true })).toBeVisible();
  await picker.setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await expect(page.getByText('单个附件最多 8 MB，每条消息附件合计最多 20 MB', { exact: true })).toBeVisible();
  await picker.setInputFiles({ name: '正常.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('list', { name: '待发送附件' }).getByRole('listitem')).toHaveCount(1);
  await picker.setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
  await expect(page.getByText('附件为空，请选择有内容的文件', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: '待发送附件' }).getByRole('listitem')).toHaveCount(1);
  expect(requests).toEqual([]);
});

test('服务端解析失败时保留输入和附件供修正重试', async ({ page }) => {
  const requests = await workspace(page, true);
  await page.locator('#chat-attachments').setInputFiles({ name: '损坏.pdf', mimeType: 'application/pdf', buffer: Buffer.from('broken') });
  const input = page.getByRole('textbox', { name: '发给 AI 的消息', exact: true });
  await input.fill('总结附件'); await input.press('Enter');
  await expect(page.getByText('附件无法读取，请检查文件内容', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('总结附件');
  await expect(page.getByRole('list', { name: '待发送附件' }).getByRole('listitem')).toHaveCount(1);
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '移除附件 损坏.pdf', exact: true }).click();
  await expect(page.getByRole('list', { name: '待发送附件' })).toHaveCount(0);
});

test('缺少 randomUUID 时仍能发送消息和附件，并生成不同请求 ID', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {value: undefined, configurable: true});
  });
  const requests=await workspace(page);
  expect(await page.evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');
  const input=page.getByRole('textbox',{name:'发给 AI 的消息',exact:true});
  await input.fill('安排今天的任务');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(1);
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button',{name:'添加附件',exact:true})).toBeEnabled();
  await page.locator('#chat-attachments').setInputFiles([
    {name:'保留.txt',mimeType:'text/plain',buffer:Buffer.from('保留的附件')},
    {name:'移除.txt',mimeType:'text/plain',buffer:Buffer.from('移除的附件')},
  ]);
  const draft=page.getByRole('list',{name:'待发送附件'});
  await expect(draft.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button',{name:'移除附件 移除.txt',exact:true}).click();
  await expect(draft.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(2);
  await expect(draft).toHaveCount(0);
  expect(requests[1].attachments.map((file:any)=>file.name)).toEqual(['保留.txt']);
  const uuidV4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  expect(requests[0].idempotency_key).toMatch(uuidV4);
  expect(requests[1].idempotency_key).toMatch(uuidV4);
  expect(requests[0].idempotency_key).not.toBe(requests[1].idempotency_key);
});
