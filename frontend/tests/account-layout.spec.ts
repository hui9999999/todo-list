import {test,expect,type Page} from '@playwright/test';

async function workspace(page:Page, failUsage=false) {
  const settings:any={version:1,timezone:'Asia/Shanghai',theme:'light',work_start:'09:00',work_end:'18:00',daily_capacity:120,recommendation_time:'09:00',memory_enabled:true,followups_enabled:true,news_enabled:false,suggestions_enabled:false,notifications_enabled:false,weather_enabled:false,weather_city:'北京',daily_call_limit:20,daily_token_limit:200000};
  const saved:any[]=[];
  await page.route('**/api/v1/me',route=>route.fulfill({json:{user:{id:'account-layout',email:'account-layout@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'}}));
  for(const path of ['tasks','projects','daily-plans'])await page.route(`**/api/v1/${path}*`,route=>route.fulfill({json:[]}));
  await page.route('**/api/v1/settings',route=>{
    if(route.request().method()==='PUT'){const body=route.request().postDataJSON();saved.push(body);expect(body.version).toBe(settings.version);Object.assign(settings,body,{version:settings.version+1});}
    return route.fulfill({json:{...settings}});
  });
  await page.route('**/api/v1/provider-connections',route=>route.fulfill({json:[{id:'connection',name:'日常助手',provider:'deepseek',region:'cn',enabled:true,key_mask:'••••••••',capabilities:{'chat-model':{chat:true,tools:true,thinking:'toggle'}}}]}));
  await page.route('**/api/v1/model-preferences',route=>route.fulfill({json:{connection_id:'connection',model:'chat-model',thinking:'auto'}}));
  await page.route('**/api/v1/usage',route=>failUsage?route.fulfill({status:503,json:{detail:'Unavailable'}}):route.fulfill({json:{chat_calls:8,background_calls:3,background_tokens:6400,call_limit:20,token_limit:200000,note:'自动调用含预留用量。',events:[]}}));
  await page.route('**/api/v1/jobs',route=>route.fulfill({json:[{id:'job',kind:'embedding',state:'completed',attempts:1,error:null}]}));
  await page.route('**/api/v1/embedding-service',route=>route.fulfill({json:{configured:true,model:'system',state:'ready'}}));
  return {settings,saved};
}

test('账户分区、条件字段与草稿保持，保存完整设置且模型凭据收起',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const {saved}=await workspace(page);
  await page.goto('/account');
  const tabs=page.getByRole('navigation',{name:'账户设置分区'});
  await expect(page.getByRole('heading',{name:'偏好设置',exact:true})).toBeVisible();
  await expect(page.locator('.workspace-main').getByText('account-layout@example.com',{exact:true})).toHaveCount(1);
  await expect(page.getByLabel('推荐时间',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'永久删除账户'})).toHaveCount(0);
  await page.getByRole('spinbutton',{name:'每日容量',exact:true}).fill('135');
  await page.getByText('今日工作建议',{exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'今日工作建议',exact:true})).toBeChecked();
  await page.getByLabel('推荐时间',{exact:true}).fill('14:00');
  await tabs.getByRole('link',{name:'AI 模型',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'API Key',exact:true})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'思考档位',exact:true})).toBeHidden();
  await page.getByRole('button',{name:'更换 API Key',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'API Key',exact:true})).toBeVisible();
  await tabs.getByRole('link',{name:'偏好设置',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'每日容量',exact:true})).toHaveValue('135');
  await expect(page.getByLabel('推荐时间',{exact:true})).toHaveValue('14:00');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.getByText('设置已保存',{exact:true})).toBeVisible();
  expect(saved[0]).toMatchObject({daily_capacity:135,recommendation_time:'14:00',suggestions_enabled:true,memory_enabled:true,weather_enabled:false,weather_city:'北京',daily_call_limit:20,daily_token_limit:200000});
  for(const [id,label] of [['preferences','偏好设置'],['model','AI 模型'],['usage','用量与运行'],['security','账户安全']]){
    await tabs.getByRole('link',{name:label,exact:true}).click();
    await expect(tabs.getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','page');
    if(id==='usage'){
      await page.getByText('运行详情',{exact:true}).click();
      await expect(page.getByRole('img',{name:'历史索引：共 1 条，已完成 1 条',exact:true})).toBeVisible();
    }
    await page.screenshot({path:info.outputPath(`account-${id}.png`),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.getByRole('button',{name:'永久删除账户',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('输入当前邮箱');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  expect(errors).toEqual([]);
});

test('用量读取失败不阻塞偏好修改与保存',async({page})=>{
  const {saved}=await workspace(page,true);
  await page.goto('/account');
  await page.getByText('智能追问',{exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'智能追问',exact:true})).not.toBeChecked();
  const followups=page.getByRole('checkbox',{name:'智能追问',exact:true});
  await followups.focus();await followups.press('Space');await expect(followups).toBeChecked();
  await followups.press('Space');await expect(followups).not.toBeChecked();
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.getByText('设置已保存',{exact:true})).toBeVisible();
  expect(saved[0].followups_enabled).toBe(false);
  await page.getByRole('navigation',{name:'账户设置分区'}).getByRole('link',{name:'用量与运行'}).click();
  await expect(page.locator('.account-usage').getByRole('alert')).toContainText('部分运行信息暂时无法读取');
});

test('运行图表汇总重复记录、各种状态及异常，刷新后更新',async({page})=>{
  await workspace(page);
  let jobs:any[]=[
    ...Array.from({length:3},(_,i)=>({id:'done-'+i,kind:'agent',state:'completed'})),
    {id:'running',kind:'agent',state:'running'}, {id:'pending',kind:'agent',state:'pending'},
    {id:'failed',kind:'agent',state:'failed',error:'模型连接暂时不可用'},
    {id:'index-done',kind:'embedding',state:'completed'}, {id:'index-cancelled',kind:'embedding',state:'cancelled'},
    {id:'unknown',kind:'新类型',state:'future-state'},
  ];
  await page.route('**/api/v1/jobs',route=>route.fulfill({json:jobs}));
  await page.goto('/account?tab=usage');
  await page.getByText('运行详情',{exact:true}).click();
  const chart=page.getByRole('figure',{name:'最近运行记录'});
  await expect(chart).toBeVisible();
  await expect(page.getByRole('img',{name:'助手回答：共 6 条，已完成 3 条，处理中 1 条，等待处理 1 条，失败 1 条',exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'历史索引：共 2 条，已完成 1 条，已取消 1 条',exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'新类型：共 1 条，其他状态 1 条',exact:true})).toBeVisible();
  await expect(chart.locator('.run-chart-total')).toHaveText('9条记录');
  await expect(chart.locator('.run-chart-legend li')).toHaveCount(6);
  await expect(chart.locator('.run-chart-axis')).toHaveText('02468');
  await page.getByText('查看异常信息（1）',{exact:true}).click();
  await expect(page.getByText('模型连接暂时不可用',{exact:true})).toBeVisible();
  jobs=[{id:'refreshed',kind:'news',state:'completed'}];
  await page.getByRole('button',{name:'刷新运行状态',exact:true}).click();
  await expect(page.getByRole('img',{name:'资讯推荐：共 1 条，已完成 1 条',exact:true})).toBeVisible();
  await expect(chart.locator('.run-chart-total')).toHaveText('1条记录');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('运行图表区分读取失败与空记录，刷新失败时保留上次图表',async({page})=>{
  await workspace(page);
  let response:{status:number;json:any}={status:503,json:{detail:'Unavailable'}};
  await page.route('**/api/v1/jobs',route=>route.fulfill(response));
  await page.goto('/account?tab=usage');
  await page.getByText('运行详情',{exact:true}).click();
  await expect(page.getByText('运行记录暂时无法读取，请稍后刷新。',{exact:true})).toBeVisible();
  await expect(page.getByRole('figure',{name:'最近运行记录'})).toHaveCount(0);
  response={status:200,json:[]};
  await page.getByRole('button',{name:'刷新运行状态',exact:true}).click();
  await expect(page.getByText('暂无运行记录，产生记录后会在这里展示。',{exact:true})).toBeVisible();
  response={status:200,json:[{id:'done',kind:'agent',state:'completed'}]};
  await page.getByRole('button',{name:'刷新运行状态',exact:true}).click();
  const bar=page.getByRole('img',{name:'助手回答：共 1 条，已完成 1 条',exact:true});
  await expect(bar).toBeVisible();
  response={status:503,json:{detail:'Unavailable'}};
  await page.getByRole('button',{name:'刷新运行状态',exact:true}).click();
  await expect(page.getByText('运行记录刷新失败，以下为上次读取结果。',{exact:true})).toBeVisible();
  await expect(bar).toBeVisible();
});
