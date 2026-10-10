import {test,expect,type Page} from '@playwright/test';

async function workspace(page:Page) {
  const settings:any={version:1,timezone:'Asia/Shanghai',theme:'light',work_start:'09:00',work_end:'18:00',daily_capacity:120,recommendation_time:'09:00',memory_enabled:true,followups_enabled:true,news_enabled:false,suggestions_enabled:false,notifications_enabled:false,weather_enabled:false,weather_city:'北京',daily_call_limit:20,daily_token_limit:200000,context_version:4};
  const saved:any[]=[];let fail=false;
  const base={version:1,notes:'',scope:'work',status:'todo',priority:'high',parent_id:null,project_id:null,hidden:false,fail_reason:'',due_at:null,due_date:null,due_timezone:'Asia/Shanghai',deleted_at:null,completed_at:null};
  const rows=[{...base,id:'theme-high',title:'整理本周项目计划',notes:'核对交付范围和需要讨论的问题。'},{...base,id:'theme-low',title:'复习学习笔记',scope:'study',priority:'low'}];
  await page.route('**/api/v1/**',route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');
    let json:unknown=[];
    if(path==='/me')json={user:{id:'theme-user',email:'themes@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/tasks')json=new URL(route.request().url()).searchParams.has('trash')?[]:rows;
    if(path==='/settings'){
      if(route.request().method()==='PUT') {
        const body=route.request().postDataJSON();
        if(fail)return route.fulfill({status:409,json:{detail:'设置已在其他页面变化，请重试'}});
        expect(body.version).toBe(settings.version);expect(body).not.toHaveProperty('context_version');
        saved.push(body);Object.assign(settings,body,{version:settings.version+1});
      }
      json=settings;
    }
    if(path==='/usage')json={chat_calls:0,background_calls:0,background_tokens:0,call_limit:20,token_limit:200000,events:[]};
    if(path==='/model-preferences')json=null;
    if(path==='/embedding-service')json={configured:false,state:'unavailable',model:''};
    return route.fulfill({json});
  });
  return {saved,settings,setFail(value:boolean){fail=value;}};
}
const trigger=(page:Page)=>page.getByRole('button',{name:'个人工作台，切换主题',exact:true});
const dialog=(page:Page)=>page.getByRole('dialog',{name:'选择主题',exact:true});
async function show(page:Page){await trigger(page).click();await expect(dialog(page)).toBeVisible();}

test('六版主题参考、即时预览取消、应用和跨页面刷新恢复',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const {saved,settings}=await workspace(page);await page.goto('/tasks');
  await expect(page).toHaveTitle('个人工作台');
  await expect(page.locator('.sidebar-header')).toContainText('个人工作台');
  await show(page);await expect(dialog(page).locator('.theme-option')).toHaveCount(6);
  await page.locator('.theme-dialog').screenshot({path:info.outputPath('themes-reference.png')});
  const palettes=[['松林夜色','dark-forest','dark'],['石墨夜色','dark-slate','dark'],['午夜蓝','dark-midnight','dark'],['奶油纸张','warm-paper','warm'],['杏仁沙色','warm-sand','warm'],['浅玫瑰','warm-rose','warm']];
  const colors:string[]=[];
  for(const [name,id,family] of palettes){
    await dialog(page).getByRole('button',{name:'预览'+name,exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette',id!);
    await expect(page.locator('html')).toHaveAttribute('data-theme',family!);
    colors.push(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(new Set(colors).size).toBe(6);expect(saved).toHaveLength(0);
  await dialog(page).getByRole('button',{name:'取消',exact:true}).click();
  await expect(dialog(page)).toBeHidden();await expect(page.locator('html')).toHaveAttribute('data-palette','light');
  await show(page);await dialog(page).getByRole('button',{name:'预览午夜蓝',exact:true}).click();await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();await expect(page.locator('html')).toHaveAttribute('data-palette','light');
  await show(page);await dialog(page).getByRole('button',{name:'预览石墨夜色',exact:true}).click();await dialog(page).getByRole('button',{name:'应用主题',exact:true}).click();
  await expect(dialog(page)).toBeHidden();expect(settings.theme).toBe('dark');expect(saved[0]).toMatchObject({theme:'dark',daily_capacity:120,memory_enabled:true,version:1});
  await expect(page.locator('html')).toHaveAttribute('data-palette','dark-slate');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-palette','dark-slate');
  await expect(page.locator('.task-card')).toHaveCount(2);
  await page.screenshot({path:info.outputPath('theme-slate.png'),fullPage:true});
  await page.goto('/focus');await expect(page.locator('html')).toHaveAttribute('data-palette','dark-slate');
  await show(page);await dialog(page).getByRole('button',{name:'预览杏仁沙色',exact:true}).click();await dialog(page).getByRole('button',{name:'应用主题',exact:true}).click();
  await expect(dialog(page)).toBeHidden();await expect(page.locator('html')).toHaveAttribute('data-palette','warm-sand');
  await page.goto('/tasks');await expect(page.locator('html')).toHaveAttribute('data-palette','warm-sand');
  await expect(page.locator('.task-card')).toHaveCount(2);
  await page.screenshot({path:info.outputPath('theme-sand.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('切换主题保留账户草稿，保存失败可取消，窄屏入口和画廊可操作',async({page},info)=>{
  const {saved,setFail}=await workspace(page);if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  await page.goto('/account');
  await page.getByRole('spinbutton',{name:'每日容量',exact:true}).fill('135');
  await show(page);await dialog(page).getByRole('button',{name:'预览浅玫瑰',exact:true}).click();
  await dialog(page).getByRole('button',{name:'应用主题',exact:true}).click();await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('spinbutton',{name:'每日容量',exact:true})).toHaveValue('135');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(page.getByText('设置已保存',{exact:true})).toBeVisible();
  expect(saved.at(-1)).toMatchObject({daily_capacity:135,theme:'warm',version:2});
  await expect(page.locator('html')).toHaveAttribute('data-palette','warm-rose');
  setFail(true);await show(page);await dialog(page).getByRole('button',{name:'预览午夜蓝',exact:true}).click();await dialog(page).getByRole('button',{name:'应用主题',exact:true}).click();
  await expect(dialog(page).getByText('设置已在其他页面变化，请重试',{exact:true})).toBeVisible();
  await dialog(page).getByRole('button',{name:'取消',exact:true}).click();await expect(dialog(page)).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-palette','warm-rose');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('theme-narrow.png'),fullPage:true});
});

test('登录页品牌也可切换主题，未登录时仅保存外观',async({page})=>{
  await page.route('**/api/v1/me',route=>route.fulfill({status:401,json:{detail:'未登录'}}));
  const requests:string[]=[];page.on('request',request=>{if(request.method()==='PUT')requests.push(request.url());});
  await page.goto('/auth');await show(page);await dialog(page).getByRole('button',{name:'预览奶油纸张',exact:true}).click();await dialog(page).getByRole('button',{name:'应用主题',exact:true}).click();
  await expect(dialog(page)).toBeHidden();await page.reload();await expect(page.locator('html')).toHaveAttribute('data-palette','warm-paper');
  expect(requests).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
