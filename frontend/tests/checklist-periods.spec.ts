import {test,expect,type Page} from '@playwright/test';
import {checklistRange} from '../src/task-period';

test.use({timezoneId:'UTC'});
async function workspace(page:Page, instant='2026-10-04T20:30:00Z', timezone='Asia/Shanghai') {
  await page.clock.install({time:new Date(instant)});
  const base={version:1,notes:'',scope:'work',priority:'mid',status:'todo',hidden:false,parent_id:null,due_at:null,due_date:null,due_timezone:null,completed_at:null,created_at:instant,updated_at:instant,deleted_at:null};
  const rows:any[]=[
    {...base,id:'today',title:'今日事项',due_date:'2026-10-05'},
    {...base,id:'zoned',title:'按账户时区归入今日',due_at:'2026-10-04T17:00:00Z'},
    {...base,id:'sunday',title:'本周日事项',due_date:'2026-10-11',scope:'study'},
    {...base,id:'next-week',title:'下周事项',due_date:'2026-10-12'},
    {...base,id:'month-end',title:'月底事项',due_date:'2026-10-31'},
    {...base,id:'november',title:'下月事项',due_date:'2026-11-01'},
    {...base,id:'year-end',title:'年底事项',due_date:'2026-12-31'},
    {...base,id:'next-year',title:'明年事项',due_date:'2027-01-01'},
    {...base,id:'planned',title:'手动加入今日的远期任务',due_date:'2027-03-01'},
    {...base,id:'overdue',title:'逾期待办',due_date:'2025-12-31'},
    {...base,id:'old-done',title:'往年已完成',due_date:'2025-12-31',status:'done',completed_at:'2025-12-31T00:00:00Z'},
    {...base,id:'done',title:'今日已完成',due_date:'2026-10-05',status:'done',completed_at:instant},
    {...base,id:'hidden',title:'隐藏事项',due_date:'2026-10-05',hidden:true},
    {...base,id:'unscheduled',title:'未设日期的事项'},
    {...base,id:'parent',title:'下月父任务',due_date:'2026-11-15'},
    {...base,id:'child',title:'今日子任务',parent_id:'parent',due_date:'2026-10-05'},
  ];
  const plans=[{id:'plan',task_id:'planned',plan_date:'2026-10-05'}];
  const requests:string[]=[];
  await page.route('**/api/v1/**',route=>{
    const request=route.request(), url=new URL(request.url()), path=url.pathname.replace('/api/v1','');
    let json:any=[];requests.push(request.method()+' '+path);
    if(path==='/me')json={user:{id:'period-test',timezone},csrf_token:'test'};
    if(path==='/settings')json={version:1,theme:'warm',weather_enabled:false,notifications_enabled:false};
    if(path==='/tasks')json=url.searchParams.has('trash')?[]:rows;
    if(path==='/daily-plans')json=url.searchParams.get('plan_date')==='2026-10-05'?plans:[];
    return route.fulfill({json});
  });
  return {rows,requests};
}
const scheduled=(page:Page)=>page.locator('[data-planning="scheduled"] .task-card');
async function ids(page:Page){return scheduled(page).evaluateAll(elements=>elements.map(el=>el.getAttribute('data-task-id')).sort());}

test('四种清单合并为单一导航，按账户日期筛选并保留待安排与父子任务',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await workspace(page);await page.goto('/tasks');
  const nav=page.getByRole('navigation',{name:'工作区',exact:true});
  await expect(nav.getByRole('link',{name:/^清单/})).toHaveCount(1);
  await expect(nav.getByRole('link',{name:/全部任务|^今日/})).toHaveCount(0);
  const tabs=page.getByRole('navigation',{name:'清单周期',exact:true});
  await expect(tabs.getByRole('link')).toHaveCount(4);
  await expect(page.getByRole('heading',{name:'今日清单',exact:true})).toBeVisible();
  await expect(page.locator('.checklist-range')).toHaveCount(0);
  const initial=['today','zoned','planned','overdue','parent','child'].sort();
  await expect.poll(()=>ids(page)).toEqual(initial);
  await expect(page.locator('[data-planning="unscheduled"]')).toContainText('未设日期的事项');
  await expect(page.getByRole('heading',{name:'待安排',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('checklist-today.png'),fullPage:true});
  for(const [period,title,extra,range] of [
    ['week','本周清单',['sunday'],'2026-10-05 ～ 2026-10-11'],
    ['month','本月清单',['sunday','next-week','month-end'],'2026-10-01 ～ 2026-10-31'],
    ['year','年度清单',['sunday','next-week','month-end','november','year-end'],'2026-01-01 ～ 2026-12-31'],
  ] as const){
    await tabs.getByRole('link',{name:title,exact:true}).click();
    await expect(page).toHaveURL(new RegExp('period='+period+'$'));
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    await expect(tabs.getByRole('link',{name:title,exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.locator('.checklist-range')).toContainText(range);
    await expect.poll(()=>ids(page)).toEqual([...initial,...extra].sort());
    await expect(page.getByRole('button',{name:'明年事项',exact:true})).toHaveCount(0);
    await page.screenshot({path:info.outputPath('checklist-'+period+'.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.reload();await expect(page.getByRole('heading',{name:'年度清单',exact:true})).toBeVisible();
  await tabs.getByRole('link',{name:'今日清单',exact:true}).focus();await page.keyboard.press('Enter');
  await expect.poll(()=>ids(page)).toEqual(initial);
  expect(state.requests.filter(request=>!request.endsWith(' /auth/desktop-link/presence')).every(request=>request.startsWith('GET '))).toBe(true);
  expect(errors).toEqual([]);
});

test('状态、分类和搜索筛选同时适用于周期清单和待安排任务',async({page},info)=>{
  await workspace(page);await page.goto('/tasks?period=week');
  await page.getByRole('combobox',{name:'筛选状态',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'全部状态',exact:true}).click();
  await expect(page.getByRole('button',{name:'今日已完成',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'往年已完成',exact:true})).toHaveCount(0);
  await page.getByText('显示隐藏任务',{exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'显示隐藏任务',exact:true})).toBeChecked();
  await expect(page.getByRole('button',{name:'隐藏事项',exact:true})).toBeVisible();
  if(info.project.name==='mobile'){
    await expect(page.locator('.today-list-toolbar')).toBeHidden();
    return;
  }
  await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill('未设日期');
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('[data-planning="unscheduled"]')).toContainText('未设日期的事项');
  await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill('');
  await page.locator('.list-toolbar').getByText('学习',{exact:true}).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'本周日事项',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'清单周期',exact:true}).getByRole('link',{name:'本月清单',exact:true}).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
});

test('跨年周、闰月和账户跨午夜后更新清单日期',async({page})=>{
  expect(checklistRange('week','2027-01-01')).toEqual({start:'2026-12-28',end:'2027-01-03'});
  expect(checklistRange('month','2028-02-29')).toEqual({start:'2028-02-01',end:'2028-02-29'});
  await workspace(page,'2026-10-04T15:59:00Z');await page.goto('/today');
  await expect(page.locator('.today-header .eyebrow')).toContainText('2026-10-04');
  await expect(page.getByRole('button',{name:'今日事项',exact:true})).toHaveCount(0);
  await page.clock.runFor(60000);
  await expect(page.locator('.today-header .eyebrow')).toContainText('2026-10-05');
  await expect(page.getByRole('button',{name:'今日事项',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'手动加入今日的远期任务',exact:true})).toBeVisible();
});
