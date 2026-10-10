import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {recordTask} from './task-entry';

async function signup(page:Page,email:string){
  await page.goto('/auth');
  await page.getByRole('button',{name:'创建账户',exact:true}).click();
  await page.getByRole('button',{name:'邮箱注册',exact:true}).click();
  await page.getByRole('textbox',{name:'邮箱',exact:true}).fill(email);
  await page.getByRole('textbox',{name:'密码',exact:true}).fill('browser-test-password');
  await page.getByRole('textbox',{name:'确认密码',exact:true}).fill('browser-test-password');
  await page.getByRole('button',{name:'注册并进入工作台',exact:true}).click();
  await expect(page.getByRole('heading',{name:'今日清单',exact:true})).toBeVisible();
}
async function nav(page:Page,name:string){
  if(name==='清单')await page.locator('nav a[href="/tasks"]').click();
  else if(name==='设置')await page.goto('/account');
  else if(name==='历史与记忆')await page.goto('/account?tab=history');
  else await page.locator('nav').getByRole('link',{name,exact:true}).click();
}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}

test('设置、记忆、日历、专注、周期、建议与无 Key 的 AI',async({page},info)=>{
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signup(page,'browser-advanced-'+randomUUID()+'@example.com');
  await recordTask(page,'安排客户汇报');
  await expect(page.getByRole('button',{name:'安排客户汇报',exact:true})).toBeVisible();
  await nav(page,'设置');
  await expect(page.getByRole('heading',{name:'偏好设置',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'向量模型 ID',exact:true})).toHaveCount(0);
  await page.getByRole('checkbox',{name:'今日工作建议',exact:true}).check();
  await page.getByRole('spinbutton',{name:'每日容量',exact:true}).fill('120');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.getByText('设置已保存',{exact:true})).toBeVisible();
  await noOverflow(page);
  await nav(page,'历史与记忆');
  await expect(page.getByRole('checkbox',{name:'按意思查找相似记录',exact:true})).toBeChecked();
  await page.getByRole('textbox',{name:'记忆内容',exact:true}).fill('下午集中处理工作');
  await page.getByRole('textbox',{name:'记忆规则名称',exact:true}).fill('工作时段');
  await page.getByRole('button',{name:'保存记忆',exact:true}).click();
  await expect(page.getByRole('heading',{name:'下午集中处理工作'})).toBeVisible();
  await page.getByRole('textbox',{name:'历史关键词',exact:true}).fill('客户汇报');
  await page.getByRole('button',{name:'查找历史',exact:true}).click();
  await expect(page.locator('.evidence-row').filter({hasText:'安排客户汇报'}).first()).toBeVisible();
  await page.getByRole('button',{name:'忘掉这条',exact:true}).click();
  await page.getByRole('button',{name:'确定',exact:true}).click();
  await expect(page.getByRole('heading',{name:'下午集中处理工作'})).not.toBeVisible();
  await nav(page,'日历');
  await expect(page.getByText('安排何时做，截止何时交。两个日期分别记录。')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({path:info.outputPath('calendar.png'),fullPage:true});
  await nav(page,'专注');
  await page.getByRole('combobox',{name:'专注任务',exact:true}).click();
  await page.getByRole('option',{name:'安排客户汇报',exact:true}).click();
  await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect(page.locator('.focus-clock')).toBeVisible();
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await expect(page.getByRole('button',{name:'继续',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'继续',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'结束并记录',exact:true}).click();
  await page.goto('/recurrences');
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('每日复核');
  await page.getByRole('button',{name:'创建周期任务',exact:true}).click();
  await expect(page.getByRole('heading',{name:'每日复核',exact:true})).toBeVisible();
  await nav(page,'清单');
  await recordTask(page,'制作汇报提纲');
  await expect(page.getByRole('button',{name:'制作汇报提纲',exact:true})).toBeVisible();
  // Newly created tasks now join today automatically; suggestions need an unplanned candidate.
  const suggestionCandidate=page.getByRole('article',{name:'制作汇报提纲',exact:true});
  if(info.project.name==='mobile')await suggestionCandidate.getByRole('button',{name:/^展开任务信息/}).click();
  await suggestionCandidate.getByRole('button',{name:'移出今日',exact:true}).click();
  await expect(suggestionCandidate.getByRole('button',{name:'加入今日',exact:true})).toBeEnabled();
  await nav(page,'资讯');
  await expect(page.getByRole('heading',{name:'关注内容',exact:true})).toBeVisible();
  // Advice remains available through its API; the news page now contains articles only.
  const csrf=(await (await page.request.get('/api/v1/me')).json()).csrf_token;
  const headers={Origin:'http://localhost:5174','X-CSRF-Token':csrf};
  expect((await page.request.post('/api/v1/recommendations/refresh?kind=suggestions',{headers})).ok()).toBe(true);
  let recommendation:any;
  await expect(async()=>{
    const recommendations=await (await page.request.get('/api/v1/recommendations?kind=suggestions')).json();
    recommendation=recommendations.find((item:any)=>item.title.includes('制作汇报提纲'));
    expect(recommendation).toBeTruthy();
  }).toPass({timeout:60000});
  expect((await page.request.post('/api/v1/recommendations/'+recommendation.id+'/accept',{headers})).ok()).toBe(true);
  await nav(page,'AI 助手');
  await page.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).fill('买牛奶');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByText('请先在设置中配置并测试对话模型',{exact:true})).toBeVisible();
  await noOverflow(page);
  await nav(page,'统计');
  await expect(page.getByText('期间专注分钟',{exact:true})).toBeVisible();
  await noOverflow(page);
  await nav(page,'设置');
  await page.getByRole('combobox',{name:'主题',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'夜间',exact:true}).click();
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:info.outputPath('settings-dark.png'),fullPage:true});
  await noOverflow(page);
  expect(errors).toEqual([]);
  await page.getByRole('navigation',{name:'账户设置分区'}).getByRole('link',{name:'账户安全'}).click();
  await page.getByRole('button',{name:'退出当前账户',exact:true}).click();
  await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
});

test('保存并启用自动测试新模型，失败时保留原默认模型',async({page})=>{
  await signup(page,'browser-model-'+randomUUID()+'@example.com');
  const selected={connection_id:'mock-connection',model:'old-model',thinking:'auto'};
  const calls:string[]=[];
  let failProbe=false;
  let noDefault=false;
  await page.route('**/api/v1/provider-connections',route=>route.fulfill({json:[{id:'mock-connection',name:'测试连接',provider:'deepseek',region:'cn',enabled:true}]}));
  await page.route('**/api/v1/provider-connections/mock-connection/models?refresh=true',route=>route.fulfill({json:{models:[{id:'old-model',name:'旧模型'},{id:'new-model',name:'新模型'}],refreshed_at:'2026-10-01',error:null}}));
  await page.route('**/api/v1/provider-connections/mock-connection/test',route=>{
    calls.push('test:'+route.request().postDataJSON().model);
    return failProbe?route.fulfill({status:502,json:{detail:'Key 无效或模型权限不足'}}):route.fulfill({json:{capabilities:{chat:true,tools:true,thinking:'unknown'}}});
  });
  await page.route('**/api/v1/model-preferences',async route=>{
    if(route.request().method()==='PUT'){noDefault=false;calls.push('save:'+route.request().postDataJSON().model);Object.assign(selected,route.request().postDataJSON());}
    await route.fulfill({json:noDefault?null:selected});
  });
  await nav(page,'设置');
  await page.getByRole('navigation',{name:'账户设置分区'}).getByRole('link',{name:'AI 模型'}).click();
  await expect(page.getByRole('textbox',{name:'API Key',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'更换 API Key'})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'思考档位',exact:true})).toBeHidden();
  await page.getByText('高级设置',{exact:true}).click();
  await page.getByRole('button',{name:'刷新模型目录',exact:true}).click();
  await page.getByRole('combobox',{name:'模型 ID',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'新模型 · new-model',exact:true}).click();
  await page.getByRole('button',{name:'保存并启用',exact:true}).click();
  await expect(page.getByText('模型已启用，可以和小狒聊天了',{exact:true})).toBeVisible();
  expect(selected.model).toBe('new-model');
  expect(calls).toEqual(['test:new-model','save:new-model']);
  failProbe=true;
  await page.getByRole('combobox',{name:'模型 ID',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'旧模型 · old-model',exact:true}).click();
  await page.getByRole('button',{name:'保存并启用',exact:true}).click();
  await expect(page.getByText('Key 无效或模型权限不足',{exact:true})).toBeVisible();
  expect(selected.model).toBe('new-model');
  expect(calls).toEqual(['test:new-model','save:new-model','test:old-model']);
  failProbe=false;
  await page.route('**/api/v1/provider-connections',async route=>{
    if(route.request().method()==='POST'){
      calls.push('create');
      expect(route.request().postDataJSON().name).toBe('通义千问');
      return route.fulfill({json:{id:'new-connection',name:'通义千问',provider:'bailian',region:'cn',enabled:true,capabilities:{}}});
    }
    return route.fulfill({json:[{id:'mock-connection',name:'测试连接',provider:'deepseek',region:'cn',enabled:true},{id:'new-connection',name:'通义千问',provider:'bailian',region:'cn',enabled:true,capabilities:{}}]});
  });
  await page.route('**/api/v1/provider-connections/new-connection/test',route=>{
    calls.push('test-new');
    return route.fulfill({json:{capabilities:{chat:true,tools:false}}});
  });
  await page.getByRole('combobox',{name:'厂商',exact:true}).focus();
  await page.getByRole('combobox',{name:'厂商',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'通义千问 / 百炼',exact:true}).click();
  await page.getByRole('textbox',{name:'API Key',exact:true}).fill('test-key-never-real');
  await page.getByRole('button',{name:'保存并启用',exact:true}).click();
  await expect(page.getByText('当前已启用：qwen-plus',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'API Key',exact:true})).toHaveCount(0);
  expect(selected.connection_id).toBe('new-connection');
  expect(calls.slice(-3)).toEqual(['create','test-new','save:qwen-plus']);
  // Reproduce the reported state: a saved connection exists but no default is enabled.
  noDefault=true;
  await nav(page,'AI 助手');
  await nav(page,'设置');
  await page.getByRole('navigation',{name:'账户设置分区'}).getByRole('link',{name:'AI 模型'}).click();
  await expect(page.getByText('还未启用对话模型，保存后就可以和小狒聊天。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'更换 API Key'})).toBeVisible();
  await page.getByRole('button',{name:'保存并启用',exact:true}).click();
  await expect(page.getByText('当前已启用：deepseek-flash',{exact:true})).toBeVisible();
  expect(selected.connection_id).toBe('mock-connection');
  expect(calls.slice(-2)).toEqual(['test:deepseek-flash','save:deepseek-flash']);
});

test('小狒铺满工作区、长对话独立滚动且新对话清理流式回答',async({page})=>{
  await signup(page,'browser-stream-'+randomUUID()+'@example.com');
  let chat=0;
  let longHistory=false;
  async function expectWorkspaceLayout() {
    const geometry=await page.evaluate(()=>{
      const main=document.querySelector('.workspace-main-ai')!.getBoundingClientRect();
      const scroll=document.querySelector('.ai-chat-scroll')!.getBoundingClientRect();
      const composer=document.querySelector('.ai-composer')!.getBoundingClientRect();
      return {mainRight:main.right,mainBottom:main.bottom,composerBottom:composer.bottom,scrollBottom:scroll.bottom,composerTop:composer.top,width:innerWidth,height:innerHeight,bodyWidth:document.documentElement.scrollWidth,bodyHeight:document.documentElement.scrollHeight};
    });
    expect(Math.abs(geometry.mainRight-geometry.width)).toBeLessThan(2);
    expect(Math.abs(geometry.mainBottom-geometry.height)).toBeLessThan(2);
    expect(Math.abs(geometry.composerBottom-geometry.height)).toBeLessThan(2);
    expect(geometry.scrollBottom).toBeLessThanOrEqual(geometry.composerTop+1);
    expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.bodyHeight).toBeLessThanOrEqual(geometry.height);
    await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport();
  }
  const run={id:'mock-run',conversation_id:'mock-chat-1',status:'running',proposals:[]};
  await page.route('**/api/v1/conversations**',async route=>{
    const url=new URL(route.request().url()),method=route.request().method();
    if(url.pathname==='/api/v1/conversations')return route.fulfill({json:method==='POST'?{id:'mock-chat-'+(++chat),title:'新对话'}:Array.from({length:chat},(_,i)=>({id:'mock-chat-'+(i+1),title:'对话 '+(i+1)}))});
    if(method==='POST')return route.fulfill({json:run});
    return route.fulfill({json:{messages:longHistory?Array.from({length:30},(_,i)=>({id:'message-'+i,role:i%2?'assistant':'user',content:'长对话测试 '+i+'\n我们把这件事分成三个小步骤，先确定目标，再整理材料，最后检查安排。'.repeat(4)})):[],runs:!longHistory&&url.pathname.includes('mock-chat-1/')?[run]:[]}});
  });
  await page.route('**/api/v1/agent-runs/mock-run',route=>route.fulfill({json:run}));
  await page.route('**/api/v1/agent-runs/mock-run/events?after=*',route=>route.fulfill({contentType:'text/event-stream',body:'id: 1\nevent: answer_delta\ndata: {"text":"上一段正在生成的回答"}\n\n'}));
  await nav(page,'AI 助手');
  await expect(page.getByRole('heading',{name:'小狒 AI 助手'})).toBeVisible();
  await expectWorkspaceLayout();
  await page.getByRole('textbox',{name:'发给 AI 的消息'}).fill('上一段问题');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByText('上一段正在生成的回答',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText('上一段正在生成的回答',{exact:true})).toHaveCount(0);
  longHistory=true;
  await page.getByRole('combobox',{name:'历史对话'}).focus();
  await page.getByRole('combobox',{name:'历史对话'}).press('ArrowDown');
  await page.getByRole('option',{name:'对话 1',exact:true}).click();
  await expect(page.locator('.chat-message')).toHaveCount(30);
  await expectWorkspaceLayout();
  const composerBefore=await page.locator('.ai-composer').boundingBox();
  expect(await page.locator('.ai-chat-scroll').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await page.locator('.ai-chat-scroll').evaluate(el=>{el.scrollTop=0;});
  expect((await page.locator('.ai-composer').boundingBox())?.y).toBe(composerBefore?.y);
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport();
});

test('保存通知开关立即生效',async({page})=>{
  await page.clock.install();
  await page.addInitScript(()=>{
    const auditWindow=window as unknown as {notificationCount:number;Notification:unknown};
    auditWindow.notificationCount=0;
    auditWindow.Notification=class {static permission='granted';static requestPermission(){return Promise.resolve('granted');}constructor(){auditWindow.notificationCount++;}};
  });
  await signup(page,'browser-notify-'+randomUUID()+'@example.com');
  const created=await page.evaluate(async()=>{
    const session=await (await fetch('/api/v1/me')).json();
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:session.user.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const response=await fetch('/api/v1/tasks',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf_token},body:JSON.stringify({title:'到期通知测试',due_date:day})});
    return {status:response.status,body:await response.json()};
  });
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  await nav(page,'设置');
  await page.getByRole('checkbox',{name:'浏览器内到期通知',exact:true}).check();
  const enabledResponse=page.waitForResponse(response=>response.url().endsWith('/api/v1/settings')&&response.request().method()==='PUT');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  expect((await (await enabledResponse).json()).notifications_enabled).toBe(true);
  await expect(page.getByRole('button',{name:'保存设置',exact:true})).toBeEnabled();
  await expect(page.getByText('设置已保存',{exact:true})).toBeVisible();
  await page.clock.runFor(61000);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {notificationCount:number}).notificationCount)).toBe(1);
  await page.getByText('浏览器内到期通知',{exact:true}).click();
  // Unsaved draft edits must not change the notification setting already in effect.
  await page.clock.fastForward(86400000);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {notificationCount:number}).notificationCount)).toBe(2);
  await page.getByRole('button',{name:'关闭全部提醒',exact:true}).click();
  const disabledResponse=page.waitForResponse(response=>response.url().endsWith('/api/v1/settings')&&response.request().method()==='PUT');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  expect((await (await disabledResponse).json()).notifications_enabled).toBe(false);
  await expect(page.getByRole('button',{name:'保存设置',exact:true})).toBeEnabled();
  await page.clock.fastForward(86400000);
  expect(await page.evaluate(()=>(window as unknown as {notificationCount:number}).notificationCount)).toBe(2);
});
