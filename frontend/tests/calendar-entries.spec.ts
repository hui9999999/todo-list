import {test,expect,type Page} from '@playwright/test';

test.use({timezoneId:'UTC'});

async function workspace(page:Page){
  await page.clock.install({time:new Date('2026-10-04T20:30:00Z')});
  const base={title:'背八股文',version:1,notes:'',scope:'study',status:'todo',priority:'mid',hidden:false,parent_id:null,due_timezone:'Asia/Shanghai',created_at:'2026-10-04T20:30:00Z',updated_at:'2026-10-04T20:30:00Z',deleted_at:null};
  const timed={...base,id:'timed',due_date:null,due_at:'2026-10-04T16:30:00Z'};
  const dated={...base,id:'dated',due_date:'2026-10-05',due_at:null};
  let planned=true;
  const removed:string[]=[];
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1','');
    let json:any=[];
    if(path==='/me')json={user:{id:'calendar-entries-user',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={version:1,theme:'warm',weather_enabled:false,notifications_enabled:false};
    if(path==='/tasks')json=url.searchParams.has('trash')?[]:[timed,dated];
    if(path==='/daily-plans/plan-timed' && request.method()==='DELETE'){planned=false;removed.push(path);json={message:'已移出安排'};}
    if(path==='/calendar')json=[
      ...(planned?[{date:'2026-10-05',kind:'plan',plan_id:'plan-timed',task:timed}]:[]),
      {date:'2026-10-05',kind:'due',task:dated},
      {date:'2026-10-05',kind:'due',task:timed},
      {date:'2026-10-06',kind:'plan',plan_id:'plan-next-day',task:timed},
    ];
    await route.fulfill({json});
  });
  await page.goto('/calendar');
  const detail=page.getByLabel('所选日期任务',{exact:true});
  await expect(detail.getByRole('heading',{name:'2026-10-05',exact:true})).toBeVisible();
  await expect(detail.getByRole('status')).toHaveCount(0);
  return {detail,removed};
}

test('同日截止与安排合为一行，截止时刻按账号时区显示，同名任务分别保留',async({page},info)=>{
  const {detail}=await workspace(page);
  const rows=detail.getByRole('article');
  await expect(rows).toHaveCount(2);
  const timed=rows.filter({hasText:'截止 2026-10-05 00:30'});
  await expect(timed).toHaveCount(1);
  await expect(timed.locator('.el-tag')).toHaveText(['截止 2026-10-05 00:30','安排']);
  await expect(timed.getByRole('button',{name:'移出安排',exact:true})).toBeEnabled();
  await expect(timed.locator('time')).toHaveAttribute('datetime','2026-10-04T16:30:00Z');
  const dated=rows.filter({has:page.locator('time[datetime="2026-10-05"]')});
  await expect(dated.locator('time')).toHaveText('2026-10-05');
  await expect(dated.locator('.el-tag')).toHaveText(['截止 2026-10-05']);
  await expect(dated.getByRole('button')).toHaveCount(0);
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  await detail.scrollIntoViewIfNeeded();
  if(info.project.name==='mobile'){
    const task=await timed.boundingBox(),button=await timed.getByRole('button',{name:'移出安排',exact:true}).boundingBox();
    expect(task!.height).toBeLessThan(100);
    expect(button!.height).toBeGreaterThanOrEqual(36);
    expect(button!.x+button!.width).toBeLessThanOrEqual(320);
  }
  await page.screenshot({path:info.outputPath('calendar-merged-deadlines.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.el-calendar-day').filter({has:page.locator('[data-calendar-date="2026-10-06"]')}).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.el-tag')).toHaveText(['截止 2026-10-05 00:30','安排']);
  await expect(rows.locator('time')).toHaveText('2026-10-05 00:30');
});

test('移出合并行的安排后保留截止记录，刷新仍显示截止',async({page})=>{
  const {detail,removed}=await workspace(page);
  await detail.getByRole('button',{name:'移出安排',exact:true}).click();
  await expect(detail.getByRole('button',{name:'移出安排',exact:true})).toHaveCount(0);
  expect(removed).toEqual(['/daily-plans/plan-timed']);
  const rows=detail.getByRole('article');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({hasText:'截止 2026-10-05 00:30'}).locator('.el-tag')).toHaveText(['截止 2026-10-05 00:30']);
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({hasText:'截止 2026-10-05 00:30'}).locator('.el-tag')).toHaveText(['截止 2026-10-05 00:30']);
  await expect(detail.getByRole('button',{name:'移出安排',exact:true})).toHaveCount(0);
});

test('日历日期可用键盘选择，数量合并同一任务的安排和截止，空日期显示引导',async({page})=>{
  const {detail}=await workspace(page);
  const today=page.locator('button[data-calendar-date="2026-10-05"]');
  await expect(today).toHaveAttribute('aria-current','date');
  await expect(today).toHaveAttribute('aria-pressed','true');
  await expect(today).toHaveAccessibleName('2026-10-05，今天，2 项任务，1 项安排，2 项截止');
  await expect(detail.locator('.calendar-agenda-count')).toHaveText('2 项任务');
  await today.focus();await today.press('ArrowRight');
  const next=page.locator('button[data-calendar-date="2026-10-06"]');
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute('aria-pressed','true');
  await expect(detail.getByRole('heading',{name:'2026-10-06',exact:true})).toBeVisible();
  await expect(detail.getByRole('article')).toHaveCount(1);
  await next.press('ArrowDown');
  await expect(detail.getByRole('heading',{name:'2026-10-13',exact:true})).toBeVisible();
  await expect(detail.locator('.calendar-empty')).toContainText('这一天还没有安排或截止任务。');
  await expect(detail.locator('.calendar-agenda-count')).toHaveText('0 项任务');
  await page.getByRole('button',{name:'今天',exact:true}).click();
  await expect(today).toHaveAttribute('aria-pressed','true');
});
