import {test,expect,type Page} from '@playwright/test';
import {recordTask} from './task-entry';

async function setup(page:Page,empty=false){
  const instant='2026-10-03T02:00:00Z';await page.clock.install({time:new Date(instant)});
  const base={id:'',title:'',version:1,notes:'',scope:'work',status:'todo',priority:'mid',parent_id:null,project_id:null,estimated_minutes:null,due_at:'2026-10-03T15:59:00+08:00',due_date:null,due_timezone:'Asia/Shanghai',fail_reason:'',hidden:false,completed_at:null,created_at:instant,updated_at:instant,deleted_at:null,legacy_period:null};
  const rows:any[]=empty?[]:[{...base,id:'project',title:'准备项目评审资料',priority:'high',notes:'整理项目进度与需要确认的问题。'}, {...base,id:'study',title:'复习英语单词',scope:'study',status:'doing',priority:'low'}, {...base,id:'life',title:'整理房间',scope:'life',status:'done',completed_at:instant}, {...base,id:'unplanned',title:'下周的阅读计划',scope:'life',due_at:'2026-10-10T15:59:00+08:00'}];
  const plans=rows.slice(0,3).map(row=>({id:'plan-'+row.id,task_id:row.id,plan_date:'2026-10-03'}));
  await page.route('**/api/v1/**',route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:'today-layout',email:'today-layout@example.com',nickname:'小辉',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={version:1,theme:'light',weather_enabled:true,weather_city:'娄底',notifications_enabled:false};
    if(path==='/weather')json={enabled:true,city:'娄底',current:{temperature_2m:17.5}};
    if(path==='/tasks'){
      if(request.method()==='POST'){json={...base,...request.postDataJSON(),id:'new-task'};rows.push(json);}
      else json=url.searchParams.has('trash')?[]:rows;
    }
    if(path==='/daily-plans'){
      if(request.method()==='POST'){json={id:'plan-new',...request.postDataJSON()};plans.push(json);}else json=plans;
    }
    if(/^\/tasks\/[^/]+$/.test(path)&&request.method()==='PUT'){
      const row=rows.find(row=>row.id===path.split('/')[2]);Object.assign(row,request.postDataJSON(),{version:row.version+1});json=row;
    }
    return route.fulfill({json,status:path==='/tasks'&&request.method()==='POST'?201:200});
  });
  await page.goto('/today');
  await expect(page.getByRole('status',{name:'今日天气',exact:true})).toContainText('娄底 · 17.5°C');
  return {rows,plans};
}

test('今日清单精简顶部、主题布局和分类，新建完成后更新任务列表',async({page},info)=>{
  test.skip(info.project.name==='mobile','手机版改为精简任务列表，另测');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await setup(page);
  await expect(page.locator('.today-overview')).toHaveCount(0);
  await expect(page.locator('.checklist-range')).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'快速记录任务',exact:true})).toHaveCount(0);
  await expect(page.locator('.task-card')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'下周的阅读计划',exact:true})).toHaveCount(0);
  const first=await page.locator('.task-card').first().boundingBox();
  expect(first!.y).toBeLessThan(info.project.name==='mobile'?800:620);
  for(const theme of ['light','dark','warm']){
    await page.evaluate(async value=>{const path='/src/themes.ts';(await import(path)).applyTheme(value);},theme);
    await page.screenshot({path:info.outputPath('today-'+theme+'.png'),fullPage:true,animations:'disabled'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.locator('.today-list-toolbar').getByText('学习',{exact:true}).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await recordTask(page,'整理学习笔记');
  await expect(page.getByRole('button',{name:'整理学习笔记',exact:true})).toBeVisible();
  await page.locator('.today-list-toolbar').getByText('全部',{exact:true}).click();
  await page.getByRole('button',{name:'完成：准备项目评审资料',exact:true}).click();
  await expect(page.locator('[data-task-id="project"]')).toHaveCount(0);
  await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill('找不到的内容');
  await expect(page.getByRole('heading',{name:'没有找到匹配任务',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('今日列表排除失败、取消和未显示的隐藏任务，完成后更新待办数',async({page},info)=>{
  test.skip(info.project.name==='mobile','手机筛选另测');
  const state=await setup(page);
  state.rows.find(row=>row.id==='life').status='failed';
  state.rows.push({...state.rows[0],id:'cancelled',title:'已取消的今日事项',status:'cancelled'});
  await page.reload();
  const count=page.locator('.today-list-heading > span');
  await expect(page.locator('.task-card')).toHaveCount(2);
  await expect(count).toHaveText('2 项');
  state.rows.push({...state.rows[0],id:'hidden',title:'隐藏的今日事项',hidden:true});
  await page.reload();
  await expect(count).toHaveText('2 项');
  await page.getByText('显示隐藏任务',{exact:true}).click();
  await expect(page.locator('.task-card')).toHaveCount(3);
  await expect(count).toHaveText('3 项');
  await page.getByText('显示隐藏任务',{exact:true}).click();
  await page.getByRole('button',{name:'完成：准备项目评审资料',exact:true}).click();
  await expect(count).toHaveText('1 项');
  await expect(page.locator('.task-card')).toHaveCount(1);
});

test('今日空状态保留新建入口和任务选择',async({page},info)=>{
  await setup(page,true);
  await expect(page.locator('.today-overview')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'今天还没有安排任务',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'查看年度清单',exact:true})).toHaveAttribute('href','/tasks?period=year');
  await page.screenshot({path:info.outputPath('today-empty.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'任务名称',exact:true})).toBeVisible();
});

test('手机首屏优先显示待办，精简卡片仍可展开、完成和新建',async({page},info)=>{
  test.skip(info.project.name!=='mobile','检查手机任务密度');
  const state=await setup(page);
  for(let i=0;i<4;i++)state.rows.push({...state.rows[0],id:'compact-'+i,title:['构思简历','整理课程笔记','准备面试材料','预约体检'][i],notes:'',priority:'mid'});
  await page.reload();
  await expect(page.locator('.task-card')).toHaveCount(6);
  for(const selector of ['.checklist-range','.today-overview','.today-list-toolbar','.quick-add'])await expect(page.locator('.workspace-today '+selector).first()).toBeHidden();
  const first=page.locator('[data-task-id="project"]');
  const bounds=await first.boundingBox();
  expect(bounds!.y).toBeLessThan(400);
  expect(bounds!.height).toBeLessThan(110);
  const viewport=page.viewportSize()!;
  const visible=await page.locator('.task-card').evaluateAll((cards,height)=>cards.filter(card=>card.getBoundingClientRect().bottom<=height).length,viewport.height);
  expect(visible).toBeGreaterThanOrEqual(3);
  await expect(first.getByRole('button',{name:'完成：准备项目评审资料',exact:true})).toBeVisible();
  await expect(first.getByRole('button',{name:'开始',exact:true})).toBeHidden();
  await page.clock.runFor(600);
  await page.screenshot({path:info.outputPath('mobile-task-first.png'),animations:'disabled'});
  await first.getByRole('button',{name:/展开任务信息：/}).click();
  await expect(first.locator('.task-card-notes')).toBeVisible();
  await expect(first.getByRole('button',{name:'开始',exact:true})).toBeVisible();
  await first.getByRole('button',{name:/收起任务信息：/}).click();
  await first.getByRole('button',{name:'完成：准备项目评审资料',exact:true}).click();
  await expect(first).toHaveCount(0);
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('手机新增待办');
  await page.getByRole('button',{name:'创建任务',exact:true}).click();
  await expect(page.getByRole('button',{name:'手机新增待办',exact:true})).toBeVisible();
  // A desktop filter must not remain active behind hidden phone controls.
  await page.setViewportSize({width:1024,height:844});
  await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill('手机新增待办');
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.setViewportSize({width:320,height:844});
  await expect(page.locator('.task-card')).toHaveCount(6);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const name of ['本周清单','本月清单','年度清单']){
    await page.getByRole('navigation',{name:'清单周期',exact:true}).getByRole('link',{name,exact:true}).click();
    await expect(page.locator('.today-list-toolbar')).toBeHidden();
    await expect(page.getByRole('textbox',{name:'快速记录任务',exact:true})).toBeHidden();
    expect((await page.locator('.task-card').first().boundingBox())!.y).toBeLessThan(400);
  }
});
