import { test, expect, type Page } from '@playwright/test';
import {recordTask} from './task-entry';

async function androidBridge(page: Page, loggedIn = true, weatherEnabled = false, recurrence = false) {
  await page.addInitScript(({ loggedIn, weatherEnabled, recurrence }) => {
    const state: any = { loggedIn, requests: [], files: [], shares: [], minimized: false, listeners: {}, tasks: [], rules: [], messages: [], downloads:[], run: null, polls: 0 };
    (window as any).__android = state;
    (window as any).androidBridge = {};
    const user = { id: 'android-user', nickname: '安卓测试', email: 'android@example.com', timezone: 'Asia/Shanghai' };
    const json = (data: unknown, status = 200) => ({ data, status, headers: { 'content-type': 'application/json' } });
    (window as any).Capacitor = {
      PluginHeaders: [
        { name: 'CapacitorHttp', methods: [{ name: 'request', rtype: 'promise' }] },
        { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'minimizeApp', rtype: 'promise' }] },
        { name: 'Filesystem', methods: [{ name: 'writeFile', rtype: 'promise' }] },
        { name: 'Share', methods: [{ name: 'share', rtype: 'promise' }] },
      ],
      nativeCallback: (_plugin: string, _method: string, options: any, callback: any) => { state.listeners[options.eventName] = callback; return 'listener'; },
      nativePromise: async (plugin: string, method: string, options: any) => {
        if (method === 'minimizeApp') { state.minimized = true; return {}; }
        if (plugin === 'Filesystem') { state.files.push(options); return { uri: 'file:///cache/' + options.path }; }
        if (plugin === 'Share') { state.shares.push(options); return {}; }
        if (plugin !== 'CapacitorHttp') return {};
        state.requests.push(options);
        if (state.networkError) throw new Error('network error');
        const path = new URL(options.url).pathname.replace('/api/v1', '');
        const body = options.data ? JSON.parse(options.data) : {};
        if (path === '/me') return state.loggedIn ? json({ user, csrf_token: 'native-csrf' }) : json({ detail: '请先登录' }, 401);
        if (path === '/auth/login') {
          if (body.password === 'wrong') return json({ detail: '账号或密码错误' }, 401);
          state.loggedIn = true; return json({ user, csrf_token: 'native-csrf' });
        }
        if (path === '/settings') return json({ theme: 'light', weather_enabled: weatherEnabled, weather_city: '娄底', notifications_enabled: false });
        if (path === '/weather') return json({enabled: true, city: '娄底', current: {temperature_2m: 23.5}});
        if (path === '/auth/desktop-link/presence') return json({ desktop_active: false });
        if (path === '/model-preferences') return json({ model: 'test-model' });
        if (path === '/tasks' && options.method === 'POST') {
          const task = { ...body, id: 'new-task', version: 1, created_at: new Date().toISOString(), completed_at: null, deleted_at: null };
          state.tasks.push(task); return json(task, 201);
        }
        if (path === '/tasks') return json(state.tasks);
        if (path === '/exports') return json({ version: 2, tasks: state.tasks });
        if (path === '/exports/preview') return json({ summary: { total: 0, scopes: {}, states: {} }, description: '', selection: '', timezone: 'Asia/Shanghai' });
        if (path === '/exports/report') return { status: 200, data: btoa('test-export-bytes'), headers: { 'content-type': 'application/pdf' } };
        if (path === '/conversations') {
          if(options.method==='POST') { state.messages=[{id:'greeting',role:'assistant',content:'小狒报到 🐒 想聊聊，还是一起把待办理一理？'}]; state.run=null; }
          return json(options.method === 'POST' ? { id: 'chat', title: '安卓对话' } : [{ id: 'chat', title: '安卓对话' }]);
        }
        if (path === '/conversations/chat/messages' && options.method === 'POST') {
          state.messages.push({ id: 'message', role: 'user', content: body.content });
          state.run = { id: 'native-run', status: 'pending', answer: '', clarification: null, proposals: [] }; return json(state.run);
        }
        if (path === '/conversations/chat/messages') return json({ messages: state.messages, runs: state.run ? [state.run] : [], downloads:state.downloads });
        if (path === '/assistant/exports/native-export') return {status:200,data:btoa(Array.from(new TextEncoder().encode(JSON.stringify({account:{nickname:'安卓测试'},tasks:state.tasks})),byte=>String.fromCharCode(byte)).join('')),headers:{'content-type':'application/json'}};
        if (path === '/agent-runs/native-run') {
          if (++state.polls >= 3 && state.run.status === 'pending') {
            const creating = state.messages.at(-1)?.content.startsWith('创建');
            const fields = { title: '手机 AI 任务', notes: '', scope: 'life', priority: 'mid', status: 'todo', parent_id: null, due_date: null, due_at: null, due_timezone: null, fail_reason: '', hidden: false };
            const proposal = { id: 'native-proposal', version: 1, state: 'pending', reason: '请核对任务操作。', actions: [{ kind: 'create', fields }], before: [], result: [], undone: false, expires_at: '2099-01-01T00:00:00Z' };
            if(recurrence) (proposal.actions[0] as any).recurrence={frequency:'daily',interval:1,mode:'calendar',start_date:'2026-10-09'};
            state.run = { ...state.run, status: creating ? 'awaiting_confirmation' : 'completed', answer: creating ? proposal.reason : '手机端已收到回答。', proposals: creating ? [proposal] : [] };
            state.messages.push({ id: 'reply', role: 'assistant', content: state.run.answer });
            if(state.messages.find((m:any)=>m.role==='user')?.content.startsWith('导出'))state.downloads=[{id:'native-export',message_id:'reply',label:'完整账号资料',description:'包含当前账号的资料，不含密码和密钥。',format:'json',filename:'xiaoqi-account.json'}];
          }
          return json(state.run);
        }
        if (path === '/agent-runs/native-run/events') return { status: 200, data: 'id: 3\nevent: followups\ndata: {"questions":["下一步做什么？"]}\n\nid: 4\nevent: done\ndata: {"status":"completed"}\n\n', headers: { 'content-type': 'text/event-stream' } };
        if (path === '/action-proposals/native-proposal/confirm') {
          const proposal = state.run.proposals[0]; proposal.state = 'accepted';
          state.tasks.push({ ...proposal.actions[0].fields, id: 'ai-task', version: 1, deleted_at: null, created_at: new Date().toISOString(), completed_at: null });
          proposal.result = [{ task_id: 'ai-task', version: 1 }]; state.run.status = 'completed'; return json(proposal);
        }
        return json([]);
      },
    };
  }, { loggedIn, weatherEnabled, recurrence });
}

test('原生接口登录、错误反馈、任务保存和小狒显示', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await androidBridge(page, false); await page.goto('/#/auth');
  await page.getByRole('textbox', { name: '邮箱或电话号码', exact: true }).fill('android@example.com');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('wrong');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('账号或密码错误');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('test-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/#\/today$/, { timeout: 20000 });
  await recordTask(page,'手机记录的任务');
  await expect(page.locator('[data-task-id="new-task"]')).toContainText('手机记录的任务');
  await expect(page.locator('.web-pet')).toBeVisible();
  const requests = await page.evaluate(() => (window as any).__android.requests);
  expect(requests.every((request: any) => request.url.startsWith('http://103.236.96.53:60673/api/v1/'))).toBe(true);
  const save = requests.find((request: any) => request.url.endsWith('/tasks') && request.method === 'POST');
  expect(save.headers.origin).toBe('http://103.236.96.53:60673');
  expect(save.headers['x-csrf-token']).toBe('native-csrf');
  expect(errors).toEqual([]);
});

test('安卓 AI 状态恢复、回答与后续建议', async ({ page }) => {
  await androidBridge(page); await page.goto('/#/ai');
  await page.getByRole('textbox', { name: '发给 AI 的消息', exact: true }).fill('你好');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('手机端已收到回答。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步做什么？', exact: true })).toBeVisible();
});

test('安卓新对话即时显示开场白且保留输入框上方的建议',async({page})=>{
  await androidBridge(page);await page.goto('/#/ai');
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText('小狒报到 🐒 想聊聊，还是一起把待办理一理？',{exact:true})).toBeVisible();
  const suggestions=page.getByRole('group',{name:'对话建议',exact:true}).filter({visible:true});
  await expect(suggestions.getByRole('button')).toHaveCount(3);
  await suggestions.getByRole('button',{name:'安排今天',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'发给 AI 的消息',exact:true})).toHaveValue('帮我安排今天的事情');
  expect(await page.evaluate(()=>(window as any).__android.requests.filter((r:any)=>r.method==='POST' && r.url.endsWith('/messages')).length)).toBe(0);
});

test('安卓跨页面返回助手保留当前对话与草稿',async({page})=>{
  await androidBridge(page);await page.goto('/#/ai');
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  const input=page.getByRole('textbox',{name:'发给 AI 的消息',exact:true});
  const greeting=page.getByText('小狒报到 🐒 想聊聊，还是一起把待办理一理？',{exact:true});
  await expect(greeting).toBeVisible();await input.fill('等会儿继续聊这件事');
  const nav=page.getByRole('navigation',{name:'工作区',exact:true});
  await nav.getByRole('link',{name:'日历',exact:true}).click();
  await expect(input).toBeHidden();
  await nav.getByRole('link',{name:'AI 助手',exact:true}).click();
  await expect(greeting).toBeVisible();await expect(input).toHaveValue('等会儿继续聊这件事');
  expect(await page.evaluate(()=>(window as any).__android.requests.filter((r:any)=>r.method==='POST' && r.url.endsWith('/conversations')).length)).toBe(1);
});

test('安卓助手的账号JSON文件解码后通过系统分享导出',async({page})=>{
  await androidBridge(page);await page.goto('/#/ai');
  await page.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).fill('导出我的全部账号资料');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const file=page.getByRole('region',{name:'完整账号资料导出文件',exact:true});
  await expect(file).toBeVisible();await file.getByRole('button',{name:'保存或分享',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__android.shares.length)).toBe(1);
  const stored=await page.evaluate(()=>(window as any).__android.files[0]);
  expect(stored.path).toBe('exports/xiaoqi-account.json');
  expect(JSON.parse(Buffer.from(stored.data,'base64').toString('utf-8')).account.nickname).toBe('安卓测试');
  const request=await page.evaluate(()=>(window as any).__android.requests.find((r:any)=>r.url.endsWith('/assistant/exports/native-export')));
  expect(request.responseType).toBe('blob');
});

test('安卓报告通过文件与分享插件导出', async ({ page }) => {
  await androidBridge(page); await page.goto('/#/data?tab=export');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__android.shares.length)).toBe(1);
  const file = await page.evaluate(() => (window as any).__android.files[0]);
  expect(file.directory).toBe('CACHE'); expect(file.data).toBe(Buffer.from('test-export-bytes').toString('base64'));
});

test('安卓 AI 创建任务必须预览确认后才写入', async ({ page }) => {
  await androidBridge(page); await page.goto('/#/ai');
  await page.getByRole('textbox', { name: '发给 AI 的消息', exact: true }).fill('创建手机 AI 任务');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const proposal = page.getByRole('region', { name: '任务操作预览' });
  await expect(proposal.getByText('手机 AI 任务', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__android.tasks.length)).toBe(0);
  await proposal.getByRole('button', { name: '确认这些变更' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__android.tasks.length)).toBe(1);
  await expect(proposal.getByRole('button', { name: '撤销本次操作' })).toBeVisible();
});

test('安卓周期任务预览显示频率和开始日期，并保留确认流程', async ({ page }) => {
  await androidBridge(page,true,false,true); await page.goto('/#/ai');
  await page.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).fill('创建每日任务背面试题');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const preview=page.getByRole('region',{name:'任务操作预览'});
  await expect(preview.getByText('新建周期任务',{exact:true})).toBeVisible();
  await expect(preview.getByText('每天',{exact:true})).toBeVisible();
  await expect(preview.getByText('2026-10-09',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__android.tasks.length)).toBe(0);
  await preview.getByRole('button',{name:'确认这些变更'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__android.tasks.length)).toBe(1);
  await expect(preview.getByRole('button',{name:'撤销本次操作'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('安卓返回键关闭弹窗、页面返回与根页面最小化', async ({ page }) => {
  await androidBridge(page); await page.goto('/#/today');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => (window as any).__android.listeners.backButton({ canGoBack: false }));
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__android.minimized)).toBe(false);
  await page.evaluate(() => (window as any).__android.listeners.backButton({ canGoBack: false }));
  expect(await page.evaluate(() => (window as any).__android.minimized)).toBe(true);
});

test('安卓小狒页面隐藏 Windows 启动入口且窄屏无溢出', async ({ page }, info) => {
  await androidBridge(page); await page.goto('/#/pet');
  await expect(page.getByRole('link', { name: '打开 Windows 桌宠 ↗' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '和小狒聊天', exact: true })).toBeVisible();
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 500 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('android-pet.png'), fullPage: true });
});

test('安卓断网显示可重试界面，恢复后能打开清单', async ({ page }) => {
  await androidBridge(page);
  await page.addInitScript(() => { (window as any).__android.networkError = true; });
  await page.goto('/#/today');
  await expect(page.getByRole('heading', { name: '暂时无法打开清单' })).toBeVisible();
  await page.evaluate(() => { (window as any).__android.networkError = false; });
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByRole('heading', { name: '今日清单', exact: true })).toBeVisible();
});

test('安卓分钟滚轮保存时长，返回键取消当前调整并留在专注页',async({page})=>{
  await androidBridge(page);await page.goto('/#/focus');
  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();
  const wheel=page.getByRole('listbox',{name:'专注分钟',exact:true});
  await expect.poll(()=>wheel.evaluate(node=>node.scrollTop)).toBe(24*40);
  await wheel.getByRole('option',{name:'45',exact:true}).click();
  await page.getByRole('button',{name:'确认时长',exact:true}).click();
  await expect(page.getByRole('button',{name:'修改专注分钟',exact:true})).toHaveText('45:00');
  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();
  await wheel.press('End');
  await page.evaluate(()=>(window as any).__android.listeners.backButton({canGoBack:false}));
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button',{name:'修改专注分钟',exact:true})).toHaveText('45:00');
  expect(await page.evaluate(()=>(window as any).__android.minimized)).toBe(false);
  await expect(page).toHaveURL(/#\/focus$/);
});

test('安卓周期切换保留天气与标题位置，复用原生天气结果',async({page},info)=>{
  await androidBridge(page,true,true);await page.setViewportSize({width:320,height:844});
  await page.goto('/#/today');
  const weather=page.getByRole('status',{name:'今日天气',exact:true}),tabs=page.getByRole('navigation',{name:'清单周期',exact:true});
  await expect(weather).toContainText('娄底 · 23.5°C');
  const geometry=async()=>({titleY:(await page.locator('.today-header h1').boundingBox())!.y,tabsY:(await tabs.boundingBox())!.y});
  const before=await geometry();
  for(const title of ['本周清单','本月清单','年度清单','今日清单']){
    await tabs.getByRole('link',{name:title,exact:true}).click();
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    await expect(weather).toContainText('娄底 · 23.5°C');
    await expect.poll(geometry).toEqual(before);
  }
  const weatherRequests=await page.evaluate(()=>(window as any).__android.requests.filter((request:any)=>new URL(request.url).pathname==='/api/v1/weather'));
  expect(weatherRequests).toHaveLength(1);expect(weatherRequests[0].url).toMatch(/^http:\/\/103\.236\.96\.53:60673\//);
  await page.screenshot({path:info.outputPath('android-checklist-weather.png'),animations:'disabled'});
});
