import {test,expect,type Page} from '@playwright/test';
import {shiftCalendarDate} from '../src/calendar-date';
test.use({timezoneId:'UTC'});
async function workspace(page:Page){
  await page.clock.install({time:new Date('2026-10-04T20:30:00Z')});
  const task={id:'calendar-task',title:'准备日期安排',version:1,notes:'',scope:'work',status:'todo',priority:'mid',hidden:false,parent_id:null,due_date:'2026-10-06',due_at:null,due_timezone:null,created_at:'2026-10-04T20:30:00Z',updated_at:'2026-10-04T20:30:00Z',deleted_at:null};
  const requests:URLSearchParams[]=[],plans:{task_id:string;plan_date:string}[]=[];
  let delayMonth='',release=()=>{},failMonth='';
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1','');
    let json:any=[];
    if(path==='/me')json={user:{id:'calendar-wheel-user',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={version:1,theme:'warm',weather_enabled:false,notifications_enabled:false};
    if(path==='/tasks')json=url.searchParams.has('trash')?[]:[task];
    if(path==='/daily-plans'){
      if(request.method()==='POST'){plans.push(request.postDataJSON());json={message:'已加入安排'};}
      else json=plans.filter(plan=>plan.plan_date===url.searchParams.get('plan_date')).map((plan,i)=>({...plan,id:'plan-'+i}));
    }
    if(path==='/calendar'){
      requests.push(url.searchParams);
      const month=url.searchParams.get('start')!.slice(0,7);
      if(month===delayMonth)await new Promise<void>(resolve=>{release=resolve;});
      if(month===failMonth)return route.fulfill({status:503,json:{detail:'日期安排暂时无法读取'}});
      json=[{date:month+'-06',kind:'due',task:{...task,title:month+' 的日期任务'}},
        ...plans.filter(plan=>plan.plan_date.startsWith(month)).map((plan,i)=>({date:plan.plan_date,kind:'plan',plan_id:'plan-'+i,task}))];
    }
    return route.fulfill({json});
  });
  await page.goto('/calendar');
  await expect(page.getByRole('button',{name:'滚轮选择日期',exact:true})).toBeEnabled();
  return {requests,plans,hold:(month:string)=>{delayMonth=month;},release:()=>release(),fail:(month:string)=>{failMonth=month;}};
}
async function open(page:Page){await page.getByRole('button',{name:'滚轮选择日期',exact:true}).click();return page.getByRole('dialog',{name:'选择日期',exact:true});}
const selected=(page:Page)=>page.getByRole('dialog',{name:'选择日期',exact:true}).getByLabel('已选日期',{exact:true});
async function picked(page:Page,date:string){await expect(selected(page)).toHaveText(date);}

test('鼠标滚轮选择年月日，同步日期高亮和当天任务，同月不重复请求',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await workspace(page);
  await expect(page.getByRole('heading',{name:'2026-10-05',exact:true})).toBeVisible();
  const dialog=await open(page),day=dialog.getByRole('spinbutton',{name:'选择日',exact:true});
  await day.hover();const before=await page.evaluate(()=>scrollY);
  await page.mouse.wheel(0,120);await picked(page,'2026-10-06');
  expect(await page.evaluate(()=>scrollY)).toBe(before);
  expect(state.requests).toHaveLength(1);
  await day.press('ArrowDown');await picked(page,'2026-10-07');
  expect(state.requests).toHaveLength(1);
  await day.press('ArrowUp');await picked(page,'2026-10-06');
  await expect(page.locator('.el-calendar-table td.is-selected [data-calendar-date]')).toHaveAttribute('data-calendar-date','2026-10-06');
  await dialog.getByRole('spinbutton',{name:'选择月',exact:true}).hover();
  await page.mouse.wheel(0,120);await picked(page,'2026-11-06');
  await expect.poll(()=>state.requests.length).toBe(2);
  expect(state.requests[1].get('start')).toBe('2026-11-01');expect(state.requests[1].get('end')).toBe('2026-11-30');
  await expect(page.getByLabel('所选日期任务',{exact:true})).toContainText('2026-11 的日期任务');
  await dialog.getByRole('spinbutton',{name:'选择年',exact:true}).hover();
  await page.mouse.wheel(0,120);await picked(page,'2027-11-06');
  for(const theme of ['warm','dark','light']){
    await page.evaluate(async value=>{const path='/src/themes.ts';(await import(path)).applyTheme(value);},theme);
    await page.screenshot({path:info.outputPath('date-wheel-'+theme+'.png')});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const bounds=await dialog.boundingBox(),viewport=page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);
  }
  await dialog.getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.getByRole('heading',{name:'2027-11-06',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'今天',exact:true}).click();
  await expect(page.getByRole('heading',{name:'2026-10-05',exact:true})).toBeVisible();
  await page.locator('.el-calendar-day').filter({has:page.locator('[data-calendar-date="2026-10-31"]')}).click();
  await open(page);await picked(page,'2026-10-31');
  await page.getByRole('spinbutton',{name:'选择日',exact:true}).press('ArrowDown');
  await picked(page,'2026-11-01');
  expect(errors).toEqual([]);
});

test('键盘和手机滑动处理闰年、月末、跨年，安排保存所选真实日期',async({page},info)=>{
  const state=await workspace(page);
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  const dialog=await open(page),year=dialog.getByRole('spinbutton',{name:'选择年',exact:true}),month=dialog.getByRole('spinbutton',{name:'选择月',exact:true}),day=dialog.getByRole('spinbutton',{name:'选择日',exact:true});
  await year.press('ArrowDown');await year.press('ArrowDown');
  await month.press('Home');await month.press('ArrowDown');await day.press('End');
  await picked(page,'2028-02-29');await expect(day).toHaveAttribute('aria-valuemax','29');
  await year.press('ArrowDown');await picked(page,'2029-02-28');await expect(day).toHaveAttribute('aria-valuemax','28');
  await month.press('End');await day.press('End');await day.press('ArrowDown');await picked(page,'2030-01-01');
  await day.dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch',clientY:170,bubbles:true});
  await day.dispatchEvent('pointermove',{pointerId:2,pointerType:'touch',clientY:98,bubbles:true});
  await day.dispatchEvent('pointerup',{pointerId:2,pointerType:'touch',clientY:98,bubbles:true});
  await picked(page,'2030-01-03');
  await page.screenshot({path:info.outputPath('date-wheel-keyboard-touch.png')});
  await dialog.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('combobox',{name:'安排任务',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'准备日期安排',exact:true}).click();
  await page.getByRole('button',{name:'加入此日安排',exact:true}).click();
  await expect.poll(()=>state.plans.length).toBe(1);
  expect(state.plans[0]).toEqual({task_id:'calendar-task',plan_date:'2030-01-03'});
  await expect(page.getByLabel('所选日期任务',{exact:true})).toContainText('准备日期安排');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(shiftCalendarDate('2026-12-31','day',1)).toBe('2027-01-01');
  expect(shiftCalendarDate('2028-03-31','month',-1)).toBe('2028-02-29');
  expect(shiftCalendarDate('0001-01-01','day',-1)).toBe('0001-01-01');
});

test('快速切月份只显示最新响应，加载失败可重试',async({page})=>{
  const state=await workspace(page);state.hold('2026-11');
  const dialog=await open(page),month=dialog.getByRole('spinbutton',{name:'选择月',exact:true}),day=dialog.getByRole('spinbutton',{name:'选择日',exact:true});
  await day.press('ArrowDown');await month.press('ArrowDown');
  await expect.poll(()=>state.requests.some(q=>q.get('start')==='2026-11-01')).toBe(true);
  await month.press('ArrowDown');await picked(page,'2026-12-06');
  const detail=page.getByLabel('所选日期任务',{exact:true});
  await expect(detail).toContainText('2026-12 的日期任务');
  const late=page.waitForResponse(response=>response.url().includes('start=2026-11-01'));
  state.release();await (await late).finished();
  await expect(detail).toContainText('2026-12 的日期任务');await expect(detail).not.toContainText('2026-11 的日期任务');
  state.fail('2027-01');await month.press('ArrowDown');await dialog.getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('日期安排暂时无法读取');
  await expect(detail).not.toContainText('2026-12 的日期任务');
  state.fail('');await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(detail).toContainText('2027-01 的日期任务');
});

test('触控板小幅滚动累计选择，缩放及横向手势不改变日期',async({page})=>{
  await workspace(page);const dialog=await open(page),day=dialog.getByRole('spinbutton',{name:'选择日',exact:true});
  await day.dispatchEvent('wheel',{deltaY:120,ctrlKey:true,cancelable:true});
  await day.dispatchEvent('wheel',{deltaX:120,deltaY:10,cancelable:true});
  await picked(page,'2026-10-05');
  // Emit one touchpad burst together; separate driver calls can exceed the 100 ms throttle.
  await day.evaluate(element=>{
    for(let i=0;i<4;i++)element.dispatchEvent(new WheelEvent('wheel',{deltaY:10,cancelable:true}));
    element.dispatchEvent(new WheelEvent('wheel',{deltaY:120,cancelable:true}));
  });
  await picked(page,'2026-10-06');
  await page.waitForTimeout(120);await day.dispatchEvent('wheel',{deltaY:-120,cancelable:true});await picked(page,'2026-10-05');
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
});
