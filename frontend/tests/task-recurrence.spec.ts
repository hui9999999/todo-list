import {test, expect, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

async function setup(page:Page) {
  const tasks:any[] = [], rules:any[] = [], taskPosts:any[] = [], rulePosts:any[] = [];
  let fail = false;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', '');
    let json:any = [];
    if (path === '/me') json = {user:{id:'recurrence-test', email:'repeat@example.com', timezone:'Asia/Shanghai'}, csrf_token:'test'};
    if (path === '/settings') json = {theme:'light', notifications_enabled:false, weather_enabled:false};
    if (path === '/tasks/classify') json = {scope:'study'};
    if (path === '/tasks') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); taskPosts.push(body);
        json = {...body, scope:body.scope ?? 'study', id:'ordinary', version:1}; tasks.push(json);
      } else json = url.searchParams.has('trash') ? [] : tasks;
    }
    if (path === '/recurrences') {
      if (request.method() === 'POST') {
        if (fail) { await route.fulfill({status:503, json:{detail:'周期保存暂时失败'}}); return; }
        const body = request.postDataJSON(); rulePosts.push(body);
        json = {...body, id:'rule-'+rulePosts.length, version:1, enabled:true, next_date:body.start_date}; rules.push(json);
      } else json = rules;
    }
    if (path.startsWith('/recurrences/') && request.method() === 'PUT') {
      json = rules.find(rule => rule.id === path.split('/')[2]);
      Object.assign(json, request.postDataJSON(), {version:json.version+1});
    }
    if (path.startsWith('/recurrences/') && request.method() === 'DELETE') {
      rules.find(rule => rule.id === path.split('/')[2]).enabled = false;
      json = {message:'已停止'};
    }
    await route.fulfill({json});
  });
  await page.goto('/tasks');
  return {taskPosts, rulePosts, setFailure:(value:boolean) => {fail=value;}};
}

async function select(page:Page, name:string, option:string) {
  if (name === '重复频率') {
    if (option === '不重复') { await page.getByRole('radiogroup', {name:'截止时间类型'}).getByText('具体时刻',{exact:true}).click(); return; }
    if (!await page.getByRole('combobox', {name,exact:true}).isVisible()) await page.getByRole('radiogroup', {name:'截止时间类型'}).getByText('重复',{exact:true}).click();
  }
  await page.getByRole('combobox', {name, exact:true}).press('ArrowDown');
  await page.getByRole('option', {name:option, exact:true}).click();
}

for (const [label, frequency] of [['每天','daily'], ['每周','weekly'], ['每月','monthly']]) {
  test(`新建任务创建${label}周期，共用任务字段并保留后续管理`, async ({page}, info) => {
    const {taskPosts, rulePosts} = await setup(page);
    await page.getByRole('button', {name:'新建任务', exact:true}).click();
    await page.getByRole('textbox', {name:'任务名称', exact:true}).fill('复习英语');
    await page.getByRole('textbox', {name:'备注', exact:true}).fill('复习第三章');
    await select(page, '优先级', '高');
    await select(page, '重复频率', label!);
    await page.getByRole('spinbutton', {name:'周期间隔', exact:true}).fill('2');
    await select(page, '周期生成方式', '完成后间隔');
    const start = page.getByLabel('周期开始日期', {exact:true});
    await start.fill('2099-01-31'); await start.press('Enter');
    await expect(page.getByRole('radio', {name:'重复',exact:true})).toBeChecked();
    await expect(page.getByLabel('截止时刻',{exact:true})).toHaveCount(0);
    await page.screenshot({path:info.outputPath('new-recurring-task.png'), fullPage:true});
    await page.getByRole('button', {name:'创建周期任务', exact:true}).click();
    await expect(page.locator('.el-drawer')).not.toBeVisible();
    expect(taskPosts).toHaveLength(0);
    expect(rulePosts).toHaveLength(1);
    expect(rulePosts[0]).toMatchObject({frequency, interval:2, mode:'after_completion', start_date:'2099-01-31', template:{title:'复习英语', notes:'复习第三章', scope:'study', priority:'high', due_date:null, due_at:null, due_timezone:null}});
    await page.goto('/recurrences');
    await expect(page.getByRole('heading', {name:'复习英语', exact:true})).toBeVisible();
    await page.getByRole('button', {name:'编辑后续规则', exact:true}).click();
    await page.getByRole('textbox', {name:'周期任务名称', exact:true}).fill('复习英语课程');
    await page.getByRole('button', {name:'保存后续规则', exact:true}).click();
    await expect(page.getByRole('heading', {name:'复习英语课程', exact:true})).toBeVisible();
    await page.getByRole('button', {name:'停止后续', exact:true}).click();
    await page.getByRole('button', {name:'确定', exact:true}).click();
    await expect(page.locator('.evidence-row')).toContainText('已停止');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('recurrence-management.png'), fullPage:true});
  });
}

test('周期管理使用统一新建表单，保存失败保留输入，成功刷新未来规则', async ({page}) => {
  const {rulePosts, setFailure} = await setup(page);
  await page.goto('/recurrences');
  await expect(page.getByRole('textbox', {name:'周期任务名称', exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'新建任务', exact:true}).click();
  await expect(page.getByRole('combobox', {name:'重复频率', exact:true, includeHidden:true}).locator('..').locator('..')).toContainText('每天');
  await page.getByRole('textbox', {name:'任务名称', exact:true}).fill('每天阅读');
  await select(page, '所属范围', '生活');
  setFailure(true);
  await page.getByRole('button', {name:'创建周期任务', exact:true}).click();
  await expect(page.getByText('周期保存暂时失败', {exact:true})).toBeVisible();
  await expect(page.getByRole('textbox', {name:'任务名称', exact:true})).toHaveValue('每天阅读');
  setFailure(false);
  await page.getByRole('button', {name:'创建周期任务', exact:true}).click();
  await expect(page.getByRole('heading', {name:'每天阅读', exact:true})).toBeVisible();
  expect(rulePosts[0].template.scope).toBe('life');
  expect(rulePosts[0].mode).toBe('calendar');
});

test('切回普通任务恢复截止时间，重新打开不沿用周期设置', async ({page}) => {
  const {taskPosts, rulePosts} = await setup(page);
  await page.getByRole('button', {name:'新建任务', exact:true}).click();
  await page.getByRole('textbox', {name:'任务名称', exact:true}).fill('普通任务');
  const deadline = await page.getByLabel('截止时刻', {exact:true}).inputValue();
  await select(page, '重复频率', '每周');
  await select(page, '重复频率', '不重复');
  await expect(page.getByLabel('截止时刻', {exact:true})).toHaveValue(deadline);
  await page.getByRole('button', {name:'创建任务', exact:true}).click();
  await expect.poll(() => taskPosts.length).toBe(1);
  expect(rulePosts).toHaveLength(0);
  await page.getByRole('button', {name:'新建任务', exact:true}).click();
  await expect(page.getByRole('radio', {name:'具体时刻',exact:true})).toBeChecked();
  await select(page, '重复频率', '每月');
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  await page.getByRole('button', {name:'新建任务', exact:true}).click();
  await expect(page.getByRole('radio', {name:'具体时刻',exact:true})).toBeChecked();
});

test('统一新建表单通过真实后端生成当日周期任务', async ({page}) => {
  const Origin = 'http://localhost:5174';
  const credentials = {email:`browser-recurrence-${randomUUID()}@example.com`, password:'recurrence-test-password'};
  expect((await page.request.post('/api/v1/auth/register', {headers:{Origin}, data:credentials})).status()).toBe(201);
  expect((await page.request.post('/api/v1/auth/login', {headers:{Origin}, data:credentials})).status()).toBe(200);
  await page.goto('/tasks');
  await page.getByRole('button', {name:'新建任务', exact:true}).click();
  await page.getByRole('textbox', {name:'任务名称', exact:true}).fill('每日复习英语');
  await page.getByRole('textbox', {name:'备注', exact:true}).fill('朗读第三章');
  await select(page, '优先级', '高');
  await select(page, '重复频率', '每天');
  await page.getByRole('button', {name:'创建周期任务', exact:true}).click();
  await expect(page.getByRole('button', {name:'每日复习英语', exact:true})).toBeVisible();
  const rules = await (await page.request.get('/api/v1/recurrences')).json();
  expect(rules).toHaveLength(1);
  expect(rules[0]).toMatchObject({frequency:'daily', interval:1, mode:'calendar', template:{scope:'study', notes:'朗读第三章', priority:'high'}});
  const rows = await (await page.request.get('/api/v1/tasks')).json();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({title:'每日复习英语', scope:'study', notes:'朗读第三章', priority:'high', due_date:rules[0].anchor_date, due_at:null});
});
