import { test, expect } from '@playwright/test';

test('AI 周期任务显示每日每周每月规则，确认前不执行', async ({ page }, testInfo) => {
  const errors: string[]=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/api/v1/**', route => route.fulfill({json: []}));
  await page.route('**/api/v1/me', route => route.fulfill({json: {user:{id:'user',nickname:'周期测试',timezone:'Asia/Shanghai'},csrf_token:'test'}}));
  await page.route('**/api/v1/settings', route => route.fulfill({json:{theme:'light',weather_enabled:false,notifications_enabled:false}}));
  await page.route('**/api/v1/model-preferences', route => route.fulfill({json:{model:'test-model'}}));
  const original = {id:'study',title:'背面试题',scope:'study',status:'todo',priority:'mid',version:1,notes:'保留备注',due_date:null,due_at:null,due_timezone:null};
  const proposal = {id:'period-proposal',version:1,state:'pending',reason:'请确认周期任务。',before:[original],actions:[
    {kind:'create',fields:{title:'每天读书',scope:'study'},recurrence:{frequency:'daily',interval:1,mode:'calendar',start_date:'2026-10-09'}},
    {kind:'update',task_id:'study',version:1,fields:original,recurrence:{frequency:'weekly',interval:1,mode:'calendar',start_date:'2026-10-09'}},
    {kind:'create',fields:{title:'每月整理资料',scope:'work'},recurrence:{frequency:'monthly',interval:1,mode:'after_completion',start_date:'2026-10-09'}},
  ],result:[],undone:false,expires_at:'2099-01-01T00:00:00Z'};
  let run: any = null, confirmed = false;
  await page.route('**/api/v1/tasks*', route => route.fulfill({json:[original]}));
  await page.route('**/api/v1/conversations**', route => {
    const path = new URL(route.request().url()).pathname;
    if(path === '/api/v1/conversations') return route.fulfill({json:route.request().method()==='POST'?{id:'period-chat'}:[{id:'period-chat',title:'周期任务'}]});
    if(route.request().method()==='POST') {run={id:'period-run',status:'awaiting_confirmation',proposals:[proposal]};return route.fulfill({status:202,json:run});}
    return route.fulfill({json:{messages:[],runs:run?[run]:[]}});
  });
  await page.route('**/api/v1/agent-runs/period-run', route => route.fulfill({json:run}));
  await page.route('**/api/v1/agent-runs/period-run/events?after=*', route => route.fulfill({contentType:'text/event-stream',body:'id: 1\nevent: done\ndata: {"status":"awaiting_confirmation"}\n\n'}));
  await page.route('**/api/v1/action-proposals/period-proposal/confirm', route => {
    expect(route.request().postDataJSON()).toEqual({version:1}); confirmed=true; proposal.state='accepted';run.status='completed';
    return route.fulfill({json:proposal});
  });
  await page.goto('/ai');
  const input=page.getByRole('textbox',{name:'发给 AI 的消息',exact:true});
  await input.fill('新建每日读书、每月整理资料，把背面试题设为每周任务');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const preview=page.getByRole('region',{name:'任务操作预览'});
  await expect(preview.getByText('新建周期任务',{exact:true})).toHaveCount(2);
  await expect(preview.getByText('设为周期任务',{exact:true})).toBeVisible();
  for(const period of ['每天','每周','每月']) await expect(preview.getByText(period,{exact:true})).toBeVisible();
  await expect(preview.getByText('2026-10-09',{exact:true})).toHaveCount(3);
  await expect(preview.getByText('完成后间隔',{exact:true})).toBeVisible();
  await expect(preview.getByText('保留当前任务，后续按周期生成独立任务。',{exact:true})).toBeVisible();
  expect(confirmed).toBe(false);
  await page.screenshot({path:testInfo.outputPath('recurrence-preview.png'),fullPage:true});
  await preview.getByRole('button',{name:'确认这些变更'}).click();
  await expect(preview.getByRole('button',{name:'撤销本次操作'})).toBeVisible();
  expect(confirmed).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
