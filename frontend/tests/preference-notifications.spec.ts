import {test, expect, type Page} from '@playwright/test';

async function setup(page:Page, permission:'default'|'denied'|'granted'='default') {
  await page.clock.install();
  await page.addInitScript(value=>{
    const browser=window as any;browser.nativeNotifications=[];browser.permissionRequests=0;
    browser.Notification=class {
      static permission=value;
      static async requestPermission(){browser.permissionRequests++;this.permission='granted';return 'granted';}
      constructor(title:string, options:any){browser.nativeNotifications.push({title,options});}
      close(){}
    };
  },permission);
  const settings:any={version:1,timezone:'Asia/Shanghai',theme:'light',work_start:'09:00',work_end:'18:00',daily_capacity:120,recommendation_time:'09:00',memory_enabled:true,followups_enabled:true,news_enabled:true,suggestions_enabled:true,notifications_enabled:true,weather_enabled:true,weather_city:'北京',daily_call_limit:20,daily_token_limit:200000};
  const saved:any[]=[];
  const task={id:'due-task',title:'准备明天的项目汇报，整理资料并确认所有关键数据',notes:'',scope:'work',status:'todo',priority:'high',version:1,parent_id:null,due_date:'2000-01-01',due_at:null,due_timezone:null,fail_reason:'',hidden:false,completed_at:null,deleted_at:null,created_at:'2000-01-01T00:00:00Z',updated_at:'2000-01-01T00:00:00Z',legacy_period:null};
  await page.route('**/api/v1/**',route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:'notification-'+permission,email:'preferences@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings'){
      if(route.request().method()==='PUT'){const body=route.request().postDataJSON();saved.push(body);Object.assign(settings,body,{version:settings.version+1});}
      json={...settings};
    }
    if(path==='/tasks')json=[task];
    if(path==='/weather')json={enabled:true,city:settings.weather_city,current:{temperature_2m:22}};
    if(path==='/model-preferences')json=null;
    if(path==='/usage')json={chat_calls:0,background_calls:0,background_tokens:0,call_limit:20,token_limit:200000,note:''};
    if(path==='/embedding-service')json={configured:false,state:'unconfigured'};
    return route.fulfill({json});
  });
  return {settings,saved,task};
}

test('城市可滚动、搜索和自定义，默认偏好开启与通知授权预览',async({page},info)=>{
  const {saved}=await setup(page);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/account');
  for(const label of ['浏览器内到期通知','辅助天气','使用 AI 记忆','智能追问','资讯推荐','今日工作建议'])await expect(page.getByRole('checkbox',{name:label,exact:true})).toBeChecked();
  const city=page.getByRole('combobox',{name:'天气城市',exact:true});
  await city.click();
  const popup=page.locator('.weather-city-options:visible');
  await expect(popup.getByRole('option',{name:'北京',exact:true})).toBeVisible();
  expect(await popup.locator('.el-select-dropdown__wrap').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await popup.locator('.el-select-dropdown__wrap').evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect(popup.getByRole('option',{name:'多伦多',exact:true})).toBeInViewport();
  await city.fill('苏州');
  await popup.getByRole('option',{name:'苏州',exact:true}).click();
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.getByText('设置已保存',{exact:true})).toBeVisible();
  expect(saved[0].weather_city).toBe('苏州');
  await city.fill('阿勒泰');
  await page.getByRole('option',{name:'阿勒泰',exact:true}).click();
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect.poll(()=>saved.length).toBe(2);expect(saved[1].weather_city).toBe('阿勒泰');
  await page.clock.runFor(3100);
  expect(await page.evaluate(()=>(window as any).permissionRequests)).toBe(0);
  await page.getByRole('button',{name:'开启系统通知',exact:true}).click();
  await expect(page.getByRole('heading',{name:'系统通知已开启',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).permissionRequests)).toBe(1);
  await page.getByRole('button',{name:'预览提醒',exact:true}).click();
  const reminder=page.getByRole('complementary',{name:'到期任务提醒',exact:true});
  await expect(reminder.getByRole('heading',{name:'提醒预览',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).nativeNotifications.length)).toBe(0);
  for(const theme of ['light','dark','warm']){
    await page.evaluate(async value=>{const path='/src/themes.ts';(await import(path)).applyTheme(value);},theme);
    await page.screenshot({path:info.outputPath('preference-notification-'+theme+'.png'),fullPage:true,animations:'disabled'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await reminder.getByRole('button',{name:'完成预览',exact:true}).click();
  await expect(reminder).toBeHidden();
  expect(errors).toEqual([]);
});

test('真实到期提醒二十秒后自动收起',async({page})=>{
  await setup(page,'denied');
  await page.goto('/account');
  await expect(page.getByRole('heading',{name:'系统通知被浏览器阻止',exact:true})).toBeVisible();
  await page.clock.runFor(61000);
  const reminder=page.getByRole('complementary',{name:'到期任务提醒',exact:true});
  await expect(reminder).toBeVisible();
  await page.clock.runFor(20000);
  await expect(reminder).toBeHidden();
});

for(const permission of ['denied','granted'] as const){
  test(`通知权限 ${permission} 时到期提醒可查看、关闭并避免重复`,async({page},info)=>{
    const {task}=await setup(page,permission);
    await page.goto('/account');
    await expect(page.getByRole('heading',{name:permission==='denied'?'系统通知被浏览器阻止':'系统通知已开启',exact:true})).toBeVisible();
    await page.clock.runFor(61000);
    const reminder=page.getByRole('complementary',{name:'到期任务提醒',exact:true});
    await expect(reminder.getByRole('heading',{name:task.title,exact:true})).toBeVisible();
    await expect(reminder.getByText('高优先级',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>(window as any).nativeNotifications.length)).toBe(permission==='granted'?1:0);
    await page.screenshot({path:info.outputPath('due-reminder.png'),fullPage:true,animations:'disabled'});
    await reminder.getByRole('button',{name:'查看任务',exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('textbox',{name:'任务名称',exact:true})).toHaveValue(task.title);
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
    await page.clock.runFor(61000);await expect(reminder).toBeHidden();
    await page.reload();await page.clock.runFor(61000);await expect(reminder).toBeHidden();
    expect(await page.evaluate(()=>(window as any).nativeNotifications.length)).toBe(0);
  });
}
