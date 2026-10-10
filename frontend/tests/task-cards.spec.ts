import {test,expect,type Page} from '@playwright/test';
import {recordTask} from './task-entry';

const instant='2026-10-02T02:00:00Z';
async function workspace(page:Page){
  await page.clock.install({time:new Date(instant)});
  await page.clock.pauseAt(new Date(instant));
  const base={version:1,notes:'',scope:'work',status:'todo',priority:'mid',parent_id:null,project_id:null,estimated_minutes:null,due_at:null,due_date:null,due_timezone:'Asia/Shanghai',fail_reason:'',hidden:false,completed_at:null,created_at:instant,updated_at:instant,deleted_at:null,legacy_period:null};
  const rows:any[]=[
    {...base,id:'high',title:'准备项目评审',priority:'high',estimated_minutes:30,notes:'核对设计方案和交付范围，整理需要讨论的问题。',due_at:'2026-10-02T03:30:00Z'},
    {...base,id:'child',title:'确认评审资料',priority:'low',parent_id:'high',due_at:'2026-10-02T02:15:00Z'},
    {...base,id:'mid',title:'整理本周工作记录',due_date:'2026-10-02'},
    {...base,id:'low',title:'复习英语单词',priority:'low',scope:'study',notes:'每天复习一小节，记录容易混淆的词汇。',due_at:'2026-10-05T04:00:00Z'},
    {...base,id:'overdue',title:'回复待确认事项',priority:'high',due_at:'2026-10-02T01:00:00Z'},
    {...base,id:'none',title:'整理阅读清单',scope:'life',priority:'low'},
    {...base,id:'done',title:'已完成的周报',status:'done',completed_at:instant,due_at:'2026-10-01T01:00:00Z'},
  ];
  let plans:any[]=[];
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1',''),method=request.method();
    let result:any=[];
    if(path==='/me')result={user:{id:'task-card-user',email:'task-cards@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'};
    else if(path==='/settings')result={theme:'light',timezone:'Asia/Shanghai',notifications_enabled:false,weather_enabled:false};
    else if(path==='/tasks'){
      if(method==='POST'){const row={...base,...request.postDataJSON(),id:'created'};rows.push(row);result=row;}
      else result=rows.filter(row=>Boolean(row.deleted_at)===url.searchParams.has('trash'));
    } else if(path==='/daily-plans'){
      if(method==='POST'){plans.push({id:'plan',...request.postDataJSON()});result=plans[plans.length-1];}else result=plans;
    } else if(path.startsWith('/daily-plans/')&&method==='DELETE')plans=[];
    else if(/^\/tasks\/[^/]+$/.test(path)&&method==='PUT'){
      const row=rows.find(row=>row.id===path.split('/')[2]);const body=request.postDataJSON();expect(body.version).toBe(row.version);Object.assign(row,body,{version:row.version+1});result=row;
    } else if(/\/tasks\/[^/]+\/(trash|restore)$/.test(path)){
      const row=rows.find(row=>row.id===path.split('/')[2]);expect(request.postDataJSON().version).toBe(row.version);row.deleted_at=path.endsWith('/trash')?instant:null;row.version++;result=row;
    }
    return route.fulfill({json:result,status:path==='/tasks'&&method==='POST'?201:200});
  });
  await page.goto('/tasks?period=year');
  await expect(page.locator('.task-card')).toHaveCount(6);
  return rows;
}
const card=(page:Page,id:string)=>page.locator(`[data-task-id="${id}"]`);

test('卡片优先级、实时倒计时、子任务层级、悬停与主题适配',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await workspace(page);
  await expect(card(page,'high').locator('.task-countdown')).toHaveText('剩余 01:30:00');
  await expect(card(page,'mid').locator('.task-countdown')).toHaveText('剩余 14:00:00');
  await expect(card(page,'low').locator('.task-countdown')).toHaveText('剩余 3天 02:00:00');
  await expect(card(page,'overdue').locator('.task-countdown')).toHaveText('已逾期 01:00:00');
  await expect(card(page,'none').locator('.task-countdown')).toHaveText('未设截止');
  await expect(card(page,'child').locator('.task-countdown')).toHaveClass(/countdown-urgent/);
  const shades=await Promise.all(['high','mid','low'].map(id=>card(page,id).evaluate(el=>getComputedStyle(el).borderLeftColor)));
  expect(new Set(shades).size).toBe(3);
  await expect(card(page,'high').locator('.task-card-details')).toHaveAttribute('aria-hidden','true');
  await expect(card(page,'high').locator('.task-card-notes')).toBeHidden();
  const collapsedHeight=(await card(page,'high').boundingBox())!.height;
  expect(collapsedHeight).toBeLessThan(info.project.name==='desktop'?110:165);
  await page.screenshot({path:info.outputPath('task-cards-compact.png'),fullPage:true});
  await expect(page.locator('.task-card-group').filter({has:card(page,'high')})).toContainText('确认评审资料');
  await expect(card(page,'child')).toContainText('子任务');
  if(info.project.name==='desktop'){
    await card(page,'high').hover();
    await expect.poll(()=>card(page,'high').evaluate(el=>getComputedStyle(el).transform)).not.toBe('none');
    await expect(card(page,'high').locator('.task-card-notes')).toBeVisible();
    await expect(card(page,'high').locator('.task-card-details')).toContainText('预计 30 分钟');
    await expect(card(page,'high').locator('.task-card-details')).toContainText('截止');
    await expect.poll(async()=> (await card(page,'high').boundingBox())!.height).toBeGreaterThan(collapsedHeight);
  }
  await page.clock.runFor(1000);
  await expect(card(page,'high').locator('.task-countdown')).toHaveText('剩余 01:29:59');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('task-cards.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await expect(card(page,'high')).toHaveCSS('border-left-color','rgb(232, 148, 137)');
  await page.screenshot({path:info.outputPath('task-cards-dark.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await card(page,'high').hover();
  await expect(card(page,'high')).toHaveCSS('transform','none');
  expect(errors).toEqual([]);
});

test('移开鼠标收起，展开按钮固定信息且键盘可访问',async({page},info)=>{
  await workspace(page);await page.clock.resume();
  const row=card(page,'high'),details=row.locator('.task-card-details');
  if(info.project.name==='desktop'){
    await row.hover();await expect(details).toHaveAttribute('aria-hidden','false');
    await page.getByRole('heading',{level:1,name:'年度清单',exact:true}).hover();
    await expect(details).toHaveAttribute('aria-hidden','true');
    await expect(row.locator('.task-card-notes')).toBeHidden();
  }
  await row.getByRole('button',{name:'展开任务信息：准备项目评审',exact:true}).click();
  await page.getByRole('heading',{level:1,name:'年度清单',exact:true}).hover();
  await expect(details).toHaveAttribute('aria-hidden','false');
  await expect(row.locator('.task-card-notes')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await row.getByRole('button',{name:'收起任务信息：准备项目评审',exact:true}).click();
  await page.getByRole('heading',{level:1,name:'年度清单',exact:true}).hover();
  await expect(details).toHaveAttribute('aria-hidden','true');
  await page.getByRole('button',{name:'新建任务',exact:true}).focus();
  await row.getByRole('button',{name:'准备项目评审',exact:true}).focus();
  await page.keyboard.press('Tab');
  await expect(row.getByRole('button',{name:'展开任务信息：准备项目评审',exact:true})).toBeFocused();
  await expect(details).toHaveAttribute('aria-hidden','false');
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button',{name:'收起任务信息：准备项目评审',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(row.getByRole('button',{name:'任务更多操作'})).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('触屏点开详细信息，长标题和备注不会横向溢出',async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:320,height:850},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),rows=await workspace(page);await page.clock.resume();
    rows.find(row=>row.id==='high').title='核对项目迭代计划以及下周交付事项';
    rows.find(row=>row.id==='high').notes='https://example.com/'+ 'long-path-'.repeat(40)+'\n逐项确认评审资料和截止时间。';
    await page.reload();
    const row=card(page,'high');
    await expect(row.locator('.task-card-notes')).toBeHidden();
    await row.getByRole('button',{name:/展开任务信息：/}).tap();
    await expect(row.locator('.task-card-notes')).toBeVisible();
    await expect(row.locator('.task-card-details')).toHaveAttribute('aria-hidden','false');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('task-cards-touch.png'),fullPage:true});
    await row.getByRole('button',{name:/收起任务信息：/}).tap();
    await expect(row.locator('.task-card-notes')).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }finally{await context.close();}
});

test('卡片保留编辑、完成、今日安排、垃圾站与默认截止操作',async({page},info)=>{
  const rows=await workspace(page);
  // Let drawer and dropdown transitions run while exercising their controls.
  await page.clock.resume();
  if(info.project.name==='mobile')await card(page,'high').getByRole('button',{name:/展开任务信息：/}).click();
  await card(page,'high').getByRole('button',{name:'加入今日',exact:true}).click();
  await expect(card(page,'high').getByRole('button',{name:'移出今日',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/today');await expect(card(page,'high')).toBeVisible();
  await page.goto('/tasks?period=year');
  await card(page,'low').getByRole('button',{name:'复习英语单词',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox',{name:'任务名称',exact:true})).toHaveValue('复习英语单词');
  await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('复习第二单元');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(card(page,'low')).toContainText('复习第二单元');
  await card(page,'mid').getByRole('button',{name:'完成：整理本周工作记录',exact:true}).click();
  await expect(card(page,'mid')).toHaveCount(0);
  await page.getByRole('combobox',{name:'筛选状态'}).press('ArrowDown');
  await page.getByRole('option',{name:'全部状态',exact:true}).click();
  await expect(card(page,'mid').locator('.task-countdown')).toHaveText('已完成');
  await expect(card(page,'done').locator('.task-countdown')).toHaveText('已完成');
  await card(page,'overdue').getByRole('button',{name:'任务更多操作'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('menuitem',{name:'移入垃圾站（含子任务）'}).click();
  await page.getByRole('button',{name:'移入垃圾站',exact:true}).click();
  await expect(card(page,'overdue')).toHaveCount(0);
  await page.goto('/data?tab=trash');
  await expect(card(page,'overdue').locator('.task-countdown')).toHaveText('已移入垃圾站');
  // The floating pet can cover this button at its default phone position.
  const hidePet=page.getByRole('button',{name:'隐藏网页小狒',exact:true});
  if(await hidePet.isVisible())await hidePet.click();
  await card(page,'overdue').getByRole('button',{name:'恢复',exact:true}).click();
  await expect(card(page,'overdue')).toHaveCount(0);
  await page.goto('/tasks?period=year');
  await recordTask(page,'新建倒计时任务');
  await expect(card(page,'created').locator('.task-card-deadline')).toContainText('23:59');
  expect(rows.find(row=>row.id==='created').due_at).toBe('2026-10-02T15:59:00.000Z');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('task-cards-interactions.png'),fullPage:true});
});

test('更多菜单不会打开详情，创建子任务保留父任务关系',async({page})=>{
  const rows=await workspace(page);await page.clock.resume();
  await card(page,'high').getByRole('button',{name:'任务更多操作'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('menuitem',{name:'添加子任务'}).click();
  await expect(page.getByRole('heading',{name:'添加子任务',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'任务名称',exact:true})).toHaveValue('');
  await expect(page.getByRole('textbox',{name:'备注',exact:true})).toHaveValue('');
  await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('补充评审说明');
  await page.getByRole('button',{name:'创建任务',exact:true}).click();
  expect(rows.find(row=>row.id==='created').parent_id).toBe('high');
  await expect(card(page,'created')).toContainText('子任务');
});

test('倒计时跨过截止时刻自动变为逾期',async({page})=>{
  const rows=await workspace(page);
  rows.find(row=>row.id==='high').due_at='2026-10-02T02:00:02Z';
  await page.reload();
  await expect(card(page,'high').locator('.task-countdown')).toHaveText('剩余 00:00:02');
  await page.clock.runFor(3000);
  await expect(card(page,'high').locator('.task-countdown')).toHaveText('已逾期 00:00:01');
});
