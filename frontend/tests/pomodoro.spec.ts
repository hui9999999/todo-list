import {test,expect,type Page} from '@playwright/test';

const instant='2026-10-02T02:00:00Z';
async function workspace(page:Page, completedCount=0, emptyTasks=false, initialPath='/focus') {
  await page.clock.install({time:new Date(instant)});
  const task={id:'pomodoro-task',title:'准备下一次项目评审，整理需要讨论的方案和资料',scope:'work',status:'todo',priority:'high',version:1,notes:'',hidden:false,deleted_at:null};
  const sessions:any[]=Array.from({length:completedCount},(_,index)=>({id:'completed-'+index,task_id:task.id,state:'completed',duration_seconds:1500,elapsed:1500,anchor:Date.parse(instant),version:1,started_at:instant}));
  const posts:{path:string;body:any}[]=[];
  const taskRows:any[]=emptyTasks?[]:[task], taskPosts:any[]=[];
  let failCreate=false, createGate:Promise<void>|null=null;
  let fail=false;
  const sample=(row:any,time:number)=>Math.min(row.duration_seconds,row.elapsed+(row.state==='running'?Math.max(0,Math.floor((time-row.anchor)/1000)):0));
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1',''),method=route.request().method();
    let json:unknown=[];
    if(path==='/me')json={user:{id:'pomodoro-user',email:'pomodoro@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'light',notifications_enabled:false,weather_enabled:false};
    if(path==='/auth/desktop-link/presence')json={desktop_active:true};
    if(path==='/tasks'){
      if(method==='POST') {
        const body=route.request().postDataJSON();taskPosts.push(body);
        if(createGate)await createGate;
        if(failCreate)return route.fulfill({status:503,json:{detail:'任务暂时无法创建，请重试'}});
        const created={...body,id:'created-task-'+taskPosts.length,version:1,created_at:instant,updated_at:instant,completed_at:null,deleted_at:null,legacy_period:null};
        taskRows.push(created);json=created;
      }else json=new URL(route.request().url()).searchParams.has('trash')?[]:taskRows;
    }
    if(path.startsWith('/focus-sessions')) {
      if(fail)return route.fulfill({status:503,json:{detail:'专注记录暂时无法读取'}});
      const time=await page.evaluate(()=>Date.now());
      if(method==='POST'){
        const body=route.request().postDataJSON();posts.push({path,body});
        if(path==='/focus-sessions')sessions.unshift({id:'session-'+sessions.length,task_id:body.task_id,state:'running',duration_seconds:body.minutes*60,elapsed:0,anchor:time,version:1,started_at:new Date(time).toISOString()});
        else {
          const row=sessions.find(row=>path.endsWith('/'+row.id));expect(body.version).toBe(row.version);
          row.elapsed=sample(row,time);row.anchor=time;row.version++;
          row.state=({pause:'paused',resume:'running',finish:'completed',cancel:'cancelled'} as Record<string,string>)[body.action];
        }
      }
      for(const row of sessions)if(row.state==='running'&&sample(row,time)>=row.duration_seconds){row.elapsed=row.duration_seconds;row.state='completed';row.version++;}
      json=sessions.map(row=>({...row,elapsed:sample(row,time),server_now:new Date(time).toISOString()}));
    }
    return route.fulfill({json});
  });
  await page.goto(initialPath);
  if(initialPath==='/focus')await expect(page.getByRole('button',{name:'专注',exact:true})).toBeEnabled();
  else await expect(page.getByRole('combobox',{name:'安排任务'})).toBeVisible();
  return {sessions,posts,task,taskRows,taskPosts,setFail(value:boolean){fail=value;},setCreateFail(value:boolean){failCreate=value;},holdCreation(){let release!:()=>void;createGate=new Promise<void>(resolve=>{release=resolve;});return ()=>{createGate=null;release();};}};
}
async function chooseTask(page:Page,title:string){await page.getByRole('combobox',{name:'专注任务',exact:true}).click();await page.getByRole('option',{name:title,exact:true}).click();}
const clock=(page:Page)=>page.locator('.pomodoro-dial .focus-clock');
async function focusGeometry(page:Page) {
  return page.evaluate(() => {
    const rect=(selector:string) => {
      const node=document.querySelector(selector)!;
      const box=node.getBoundingClientRect();
      return {x:box.x,y:box.y,width:box.width,height:box.height};
    };
    const node=document.querySelector('.pomodoro-dial .focus-clock')!;
    const range=document.createRange();range.selectNodeContents(node);
    const text=range.getBoundingClientRect();
    return {dial:rect('.pomodoro-dial'),controls:rect('.pomodoro-controls'),task:rect('.pomodoro-task'),clockY:text.y,scrollY};
  });
}
async function setDuration(page:Page,label:string,minutes:number){
  await page.getByRole('button',{name:'修改'+label,exact:true}).click();
  const wheel=page.getByRole('listbox',{name:label,exact:true});
  if(await wheel.isVisible()){
    await wheel.getByRole('option',{name:String(minutes),exact:true}).click();
    await page.getByRole('button',{name:'确认时长',exact:true}).click();
  }else{
    const input=page.getByRole('spinbutton',{name:label,exact:true});
    await input.fill(String(minutes));await input.press('Tab');
  }
}

test('手机进入专注页等待数据时不转圈，加载前后计时位置不跳动',async({page},info)=>{
  test.skip(info.project.name!=='mobile','手机页面切换');
  await workspace(page,0,false,'/calendar');
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let pending=false;
  await page.route('**/api/v1/focus-sessions',async route=>{
    if(route.request().method()==='GET'){pending=true;await gate;}
    await route.fallback();
  });
  await page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('link',{name:'专注',exact:true}).click();
  await expect.poll(()=>pending).toBe(true);
  const before=await focusGeometry(page);
  const spinner=await page.locator('.pomodoro-primary .is-loading').count();
  release();
  await expect(page.getByRole('button',{name:'专注',exact:true})).toBeEnabled();
  const after=await focusGeometry(page);
  expect(after.clockY).toBeCloseTo(before.clockY,0);
  expect(after.dial).toEqual(before.dial);
  expect(after.controls).toEqual(before.controls);
  expect(spinner).toBe(0);
});

test('手机运行中返回专注页立即保留计时和操作布局',async({page},info)=>{
  test.skip(info.project.name!=='mobile','手机页面切换');
  const {task}=await workspace(page);
  await page.setViewportSize({width:320,height:844});
  await chooseTask(page,task.title);
  await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeEnabled();
  await page.evaluate(()=>scrollTo(0,0));
  const before=await focusGeometry(page);
  await page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('link',{name:'日历',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'安排任务'})).toBeVisible();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let pending=false;
  await page.route('**/api/v1/focus-sessions',async route=>{
    if(route.request().method()==='GET'){pending=true;await gate;}
    await route.fallback();
  });
  await page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('link',{name:'专注',exact:true}).click();
  await expect.poll(()=>pending).toBe(true);
  const during=await focusGeometry(page);
  const label=await page.locator('.pomodoro-primary').innerText();
  release();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeEnabled();
  const after=await focusGeometry(page);
  expect(label).toBe('暂停');
  expect(during).toEqual(before);
  expect(after).toEqual(before);
});

test('手机开始专注仅在提交时显示进度，等待和完成后计时文字保持原位',async({page},info)=>{
  test.skip(info.project.name!=='mobile','手机计时位置');
  const {task,posts}=await workspace(page);
  await chooseTask(page,task.title);
  const before=await focusGeometry(page);
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let pending=false;
  await page.route('**/api/v1/focus-sessions',async route=>{
    if(route.request().method()==='POST'){pending=true;await gate;}
    await route.fallback();
  });
  await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect.poll(()=>pending).toBe(true);
  const during=await focusGeometry(page);
  const spinner=await page.locator('.pomodoro-primary .is-loading').count();
  const disabled=await page.locator('.pomodoro-primary').isDisabled();
  release();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeEnabled();
  const after=await focusGeometry(page);
  expect(spinner).toBe(1);
  expect(disabled).toBe(true);
  expect(posts).toHaveLength(1);
  expect(during.clockY+during.scrollY).toBeCloseTo(before.clockY+before.scrollY,0);
  expect(after.clockY+after.scrollY).toBeCloseTo(before.clockY+before.scrollY,0);
  await expect(page.locator('.pomodoro-primary .is-loading')).toHaveCount(0);
});

test('番茄钟外观、开始暂停继续、刷新恢复与结束记录',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const {task,posts}=await workspace(page);
  await expect(clock(page)).toHaveText('25:00');
  await expect(page.locator('.pomodoro-dial .pomodoro-state')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeDisabled();
  await page.screenshot({path:info.outputPath('pomodoro-idle.png'),fullPage:true});
  await chooseTask(page,task.title);await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  await expect(page.locator('.pomodoro-dial .pomodoro-state')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'修改专注分钟',exact:true})).toHaveCount(0);
  expect(posts[0]).toEqual({path:'/focus-sessions',body:{task_id:task.id,minutes:25}});
  await page.clock.fastForward(60000);
  await expect.poll(async()=>clock(page).textContent()).toMatch(/^23:5\d|24:00$/);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await expect(page.getByRole('button',{name:'继续',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'修改专注分钟',exact:true})).toHaveCount(0);
  const frozen=await clock(page).textContent();await page.clock.fastForward(120000);await expect(clock(page)).toHaveText(frozen!);
  await page.reload();await expect(page.getByRole('button',{name:'继续',exact:true})).toBeVisible();await expect(clock(page)).toHaveText(frozen!);
  await page.getByRole('button',{name:'继续',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'短休息',exact:true}).isDisabled().then(value=>expect(value).toBe(true));
  await page.getByRole('button',{name:'结束并记录',exact:true}).click();
  await expect(page.getByRole('button',{name:'短休息',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(clock(page)).toHaveText('05:00');
  await expect(page.getByRole('status').filter({hasText:'已记录'})).toBeVisible();
  await expect(page.getByRole('complementary',{name:'专注安排'}).getByRole('region',{name:'今日专注'}).locator('strong').first()).toHaveText('1');
  await page.locator('.pomodoro-history > summary').click();
  await expect(page.locator('.pomodoro-history-row').first()).toContainText('已结束');
  await page.screenshot({path:info.outputPath('pomodoro-rest.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:info.outputPath('pomodoro-dark.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('第四轮到时进入长休息，休息暂停和刷新不丢时间且不计入专注',async({page},info)=>{
  const {task,posts}=await workspace(page,3);
  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();
  if(info.project.name==='mobile')await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  else{
    await page.getByRole('spinbutton',{name:'专注分钟',exact:true}).fill('');
    await page.getByRole('spinbutton',{name:'专注分钟',exact:true}).press('Escape');
  }
  await expect(clock(page)).toHaveText('25:00');
  await setDuration(page,'专注分钟',1);
  await expect(clock(page)).toHaveText('01:00');
  await chooseTask(page,task.title);await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  await page.clock.fastForward(65000);
  await expect(page.getByRole('button',{name:'长休息',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(clock(page)).toHaveText('15:00');
  const before=posts.length;
  await page.getByRole('button',{name:'开始休息',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停休息',exact:true})).toBeVisible();
  await expect(page.locator('.pomodoro-dial .pomodoro-state')).toHaveCount(0);
  await page.clock.fastForward(60000);
  await page.getByRole('button',{name:'暂停休息',exact:true}).click();
  const remaining=await clock(page).textContent();
  await page.clock.fastForward(120000);await expect(clock(page)).toHaveText(remaining!);
  await page.reload();await expect(page.getByRole('button',{name:'继续休息',exact:true})).toBeVisible();await expect(clock(page)).toHaveText(remaining!);
  await page.getByRole('button',{name:'继续休息',exact:true}).click();
  await page.clock.fastForward(60000);await page.reload();
  await expect(page.getByRole('button',{name:'暂停休息',exact:true})).toBeVisible();
  expect(await clock(page).textContent()).not.toBe(remaining);
  await page.clock.fastForward(16*60000);
  await expect(clock(page)).toHaveText('00:00');
  await expect(page.getByRole('status').filter({hasText:'休息结束'})).toBeVisible();
  expect(posts).toHaveLength(before);
  await expect(page.locator('.pomodoro-today strong').first()).toHaveText('4');
  await expect(page.locator('.pomodoro-today strong').last()).toHaveText('76分钟');
  await page.getByRole('button',{name:'返回专注',exact:true}).click();
  await expect(clock(page)).toHaveText('01:00');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('pomodoro-next-round.png'),fullPage:true});
});

test('中央时间直接编辑，各模式分别保存，范围校验与取消不影响计时',async({page},info)=>{
  test.skip(info.project.name==='mobile','手机滚轮另测，桌面保留直接输入');
  const {task,posts}=await workspace(page);
  await expect(page.getByText('时长设置',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();
  const input=page.getByRole('spinbutton',{name:'专注分钟',exact:true});
  await input.fill('181');await input.press('Enter');
  await expect(page.getByRole('alert').filter({hasText:'请输入 1–180 的整数分钟'})).toBeVisible();
  await input.fill('0');await input.press('Enter');await expect(input).toBeVisible();
  await input.fill('1.5');await input.press('Enter');await expect(input).toBeVisible();
  await input.press('Escape');await expect(clock(page)).toHaveText('25:00');
  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();
  await input.fill('60');await input.press('Enter');await expect(clock(page)).toHaveText('60:00');
  await page.getByRole('button',{name:'短休息',exact:true}).click();
  await page.getByRole('button',{name:'修改短休息分钟',exact:true}).click();
  await page.getByRole('spinbutton',{name:'短休息分钟',exact:true}).fill('7');
  await page.getByRole('spinbutton',{name:'短休息分钟',exact:true}).press('Tab');
  await expect(clock(page)).toHaveText('07:00');
  await page.getByRole('button',{name:'长休息',exact:true}).click();
  await page.getByRole('button',{name:'修改长休息分钟',exact:true}).click();
  const longInput=page.getByRole('spinbutton',{name:'长休息分钟',exact:true});
  await longInput.fill('61');await longInput.press('Enter');
  await expect(page.getByRole('alert').filter({hasText:'请输入 1–60 的整数分钟'})).toBeVisible();
  await longInput.fill('18');await longInput.press('Enter');
  await page.reload();await expect(clock(page)).toHaveText('18:00');
  await page.getByRole('button',{name:'短休息',exact:true}).click();await expect(clock(page)).toHaveText('07:00');
  await page.getByRole('button',{name:'开始休息',exact:true}).click();
  await expect(page.getByRole('button',{name:'修改短休息分钟',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'暂停休息',exact:true}).click();
  await expect(page.getByRole('button',{name:'修改短休息分钟',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'结束休息',exact:true}).click();await expect(clock(page)).toHaveText('60:00');
  await chooseTask(page,task.title);
  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();await input.fill('180');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('pomodoro-edit-duration.png'),fullPage:true});
  await input.press('Escape');await expect(clock(page)).toHaveText('60:00');
  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();await input.fill('10');
  await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  expect(posts.at(-1)).toEqual({path:'/focus-sessions',body:{task_id:task.id,minutes:10}});
});

test('手机计时优先，任务位于开始按钮下方，滚轮保存独立时长并限制运行中修改',async({page},info)=>{
  test.skip(info.project.name!=='mobile','手机布局与滚轮');
  const {task,posts}=await workspace(page);
  await expect(page.locator('.workspace-focus > .page-header')).toBeHidden();
  await expect(page.getByRole('heading',{name:'本轮任务',exact:true})).toBeHidden();
  await expect(page.getByText('点击时间修改时长',{exact:true})).toHaveCount(0);
  const start=await page.getByRole('button',{name:'开始专注',exact:true}).boundingBox();
  const choice=await page.getByRole('combobox',{name:'专注任务',exact:true}).boundingBox();
  expect(choice!.y).toBeGreaterThan(start!.y+start!.height);
  expect(choice!.y+choice!.height).toBeLessThan(844);
  expect((await page.locator('.pomodoro-dial').boundingBox())!.y).toBeLessThan(240);
  await page.screenshot({path:info.outputPath('focus-mobile.png'),animations:'disabled'});

  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();
  const wheel=page.getByRole('listbox',{name:'专注分钟',exact:true});
  await expect(wheel).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(wheel.getByRole('option',{selected:true})).toHaveText('25');
  await expect.poll(()=>wheel.evaluate(node=>node.scrollTop)).toBe(24*40);
  await wheel.press('ArrowDown');
  await expect(wheel.getByRole('option',{selected:true})).toHaveText('26');
  await wheel.press('Home');await wheel.press('ArrowUp');
  await expect(wheel.getByRole('option',{selected:true})).toHaveText('1');
  await wheel.hover();await page.mouse.wheel(0,2360);
  await expect(wheel.getByRole('option',{selected:true})).toHaveText('60');
  await page.screenshot({path:info.outputPath('focus-duration-wheel.png'),animations:'disabled'});
  await page.getByRole('button',{name:'确认时长',exact:true}).click();
  await expect(clock(page)).toHaveText('60:00');
  await page.getByRole('button',{name:'修改专注分钟',exact:true}).click();
  await wheel.press('End');await wheel.press('ArrowDown');
  await expect(wheel.getByRole('option',{selected:true})).toHaveText('180');
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await expect(clock(page)).toHaveText('60:00');

  await page.getByRole('button',{name:'短休息',exact:true}).click();
  await setDuration(page,'短休息分钟',7);await expect(clock(page)).toHaveText('07:00');
  await page.getByRole('button',{name:'长休息',exact:true}).click();
  await page.getByRole('button',{name:'修改长休息分钟',exact:true}).click();
  const longWheel=page.getByRole('listbox',{name:'长休息分钟',exact:true});
  await longWheel.press('End');
  await expect(longWheel.getByRole('option',{selected:true})).toHaveText('60');
  await longWheel.getByRole('option',{name:'18',exact:true}).click();
  await page.getByRole('button',{name:'确认时长',exact:true}).click();
  await page.reload();await expect(clock(page)).toHaveText('18:00');
  await page.getByRole('button',{name:'短休息',exact:true}).click();await expect(clock(page)).toHaveText('07:00');
  await page.getByRole('button',{name:'开始休息',exact:true}).click();
  await expect(page.getByRole('button',{name:'修改短休息分钟',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'暂停休息',exact:true}).click();
  await expect(page.getByRole('button',{name:'修改短休息分钟',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'结束休息',exact:true}).click();await expect(clock(page)).toHaveText('60:00');
  await page.setViewportSize({width:320,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('focus-mobile-narrow.png'),animations:'disabled'});
  await chooseTask(page,task.title);await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  expect(posts.at(-1)).toEqual({path:'/focus-sessions',body:{task_id:task.id,minutes:60}});
  await expect(page.getByRole('button',{name:'修改专注分钟',exact:true})).toHaveCount(0);
  await expect(page.locator('.pomodoro-dial .pomodoro-state')).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveAttribute('aria-label',/^专注中，剩余 /);
});

test('取消不计轮次，失败可重试，窄屏与其他计划页面可正常使用',async({page},info)=>{
  const {task,posts,setFail}=await workspace(page);
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  await chooseTask(page,task.title);await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect(page.getByRole('button',{name:'取消',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeVisible();
  await expect(page.locator('.pomodoro-today strong').first()).toHaveText('0');
  expect(posts.at(-1)?.body.action).toBe('cancel');
  setFail(true);await page.reload();await expect(page.getByText('专注记录暂时无法读取',{exact:true})).toBeVisible();
  setFail(false);await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.getByText('专注记录暂时无法读取',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('pomodoro-narrow.png'),fullPage:true});
  await page.goto('/calendar');await expect(page.getByRole('combobox',{name:'安排任务'})).toBeVisible();
  await page.goto('/recurrences');await expect(page.getByRole('button',{name:'新建任务',exact:true})).toBeVisible();
  await page.goto('/focus');await expect(clock(page)).toHaveText('25:00');
});

test('本轮任务直接搜索选择或回车创建，创建后以真实任务开始专注',async({page},info)=>{
  const {task,taskPosts,taskRows,posts,holdCreation}=await workspace(page);
  const input=page.getByRole('combobox',{name:'专注任务',exact:true});
  await input.fill('项目评审');await input.press('Enter');
  await expect(page.locator('.pomodoro-task .el-select')).toContainText(task.title);
  expect(taskPosts).toHaveLength(0);
  await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeEnabled();
  await input.fill('  复习 Vue 组合式 API  ');
  await expect(page.getByRole('option',{name:/创建「复习 Vue 组合式 API」/})).toBeVisible();
  await page.screenshot({path:info.outputPath('pomodoro-task-create-option.png'),fullPage:true,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const release=holdCreation();await input.press('Enter');
  await expect.poll(()=>taskPosts.length).toBe(1);
  await expect(input).toBeDisabled();await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeDisabled();
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');expect(taskPosts).toHaveLength(1);
  release();await expect(input).toBeEnabled();
  await expect(page.locator('.pomodoro-task .el-select')).toContainText('复习 Vue 组合式 API');
  expect(taskPosts[0]).toMatchObject({title:'复习 Vue 组合式 API',status:'todo',priority:'mid',due_date:null,due_at:'2026-10-02T15:59:00.000Z',due_timezone:'Asia/Shanghai'});
  expect(taskPosts[0]).not.toHaveProperty('scope');
  await page.getByRole('button',{name:'开始专注',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  expect(posts.at(-1)).toEqual({path:'/focus-sessions',body:{task_id:taskRows.at(-1).id,minutes:25}});
  await expect(page.locator('.pomodoro-task-title')).toHaveText('复习 Vue 组合式 API');
  await page.goto('/tasks');await expect(page.locator('.task-card').filter({hasText:'复习 Vue 组合式 API'})).toBeVisible();
  await page.reload();await expect(page.locator('.task-card').filter({hasText:'复习 Vue 组合式 API'})).toBeVisible();
});

test('没有已有任务时可直接创建，取消输入不保存，失败后可重试且同名选已有任务',async({page},info)=>{
  const {taskPosts,taskRows,setCreateFail}=await workspace(page,0,true);
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  const input=page.getByRole('combobox',{name:'专注任务',exact:true});
  await input.click();await input.fill('   ');await input.press('Enter');expect(taskPosts).toHaveLength(0);
  await input.fill('暂不创建的任务');await input.press('Escape');expect(taskPosts).toHaveLength(0);
  await expect(page.getByRole('option').filter({hasText:'回车创建并选中'})).toHaveCount(0);
  await input.press('Enter');expect(taskPosts).toHaveLength(0);
  await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeDisabled();
  await input.fill('中文输入法任务');
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});expect(taskPosts).toHaveLength(0);
  await input.press('Escape');
  setCreateFail(true);await input.fill('失败后重试的任务');await input.press('Enter');
  await expect(page.getByRole('alert').filter({hasText:'任务暂时无法创建，请重试'})).toBeVisible();
  expect(taskRows).toHaveLength(0);await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeDisabled();
  setCreateFail(false);await input.fill('失败后重试的任务');await input.press('Enter');
  await expect(page.locator('.pomodoro-task .el-select')).toContainText('失败后重试的任务');
  await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeEnabled();
  expect(taskPosts).toHaveLength(2);expect(taskRows).toHaveLength(1);
  await input.fill('失败后重试的任务');
  await expect(page.getByRole('option').filter({hasText:'回车创建并选中'})).toHaveCount(0);
  await input.press('Enter');expect(taskPosts).toHaveLength(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('pomodoro-task-created.png'),fullPage:true});
});
