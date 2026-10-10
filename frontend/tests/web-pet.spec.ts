import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page){
  let native=false,focus=false,done=false;
  const calls:{hidden:boolean}[]=[], errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v1/**',route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    if(p.endsWith('/me'))return route.fulfill({json:{user:{id:'web-pet-user',nickname:'小辉',timezone:'Asia/Shanghai'},csrf_token:'test'}});
    if(p.endsWith('/settings'))return route.fulfill({json:{version:1,theme:'warm',weather_enabled:false,notifications_enabled:false}});
    if(p.endsWith('/desktop-link/presence')){
      calls.push(route.request().postDataJSON());
      return route.fulfill({json:{desktop_active:native}});
    }
    if(p.endsWith('/tasks'))return route.fulfill({json:url.searchParams.has('trash')?[]:[{id:'task-1',title:'复习英语',notes:'',scope:'study',status:done?'done':'doing',version:done?2:1,priority:'mid',hidden:false,parent_id:null,project_id:null,estimated_minutes:null,due_date:null,due_at:null,due_timezone:null,fail_reason:'',deleted_at:null,completed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]});
    if(p.endsWith('/focus-sessions'))return route.fulfill({json:focus?[{id:'focus-1',task_id:'task-1',state:'running',duration_seconds:1500,elapsed:100}]:[]});
    return route.fulfill({json:[]});
  });
  return {calls,errors,native:(value:boolean)=>{native=value;},focus:(value:boolean)=>{focus=value;},done:()=>{done=true;}};
}

test('免安装网页小狒自动显示、拖动记忆、聊天与退出隐藏',async({page},info)=>{
  const state=await setup(page);
  await page.goto('/today');
  const pet=page.getByRole('region',{name:'网页小狒',exact:true}),character=pet.getByRole('button',{name:'小狒，点击聊天，拖动移动位置',exact:true});
  await expect(pet).toBeVisible();
  await expect(pet.getByRole('img')).toHaveAttribute('data-ready','true');
  expect(await page.locator('iframe[data-desktop-launch]').count()).toBe(0);
  const before=(await pet.boundingBox())!;
  await character.hover();await page.mouse.down();await page.mouse.move(before.x-70,before.y-80,{steps:5});await page.mouse.up();
  const moved=(await pet.boundingBox())!;expect(moved.x).toBeLessThan(before.x-30);
  await page.reload();await expect(pet).toBeVisible();
  expect(Math.abs((await pet.boundingBox())!.x-moved.x)).toBeLessThan(2);
  await character.click();await expect(page).toHaveURL(/\/ai$/);await expect(pet).toBeVisible();
  await page.screenshot({path:info.outputPath('web-pet.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('网页与桌面版互斥，停止桌面版后网页恢复，桌宠中心不显示第二只',async({page})=>{
  const state=await setup(page),pet=page.getByRole('region',{name:'网页小狒',exact:true});
  await page.goto('/today');await expect(pet).toBeVisible();
  state.native(true);await expect(pet).toHaveCount(0);
  await expect.poll(()=>state.calls.at(-1)?.hidden).toBe(true);
  await page.goto('/pet');await expect(page.getByRole('img',{name:'小狒：陪伴',exact:true})).toHaveCount(0);
  await expect(page.getByText('小狒正在桌面陪伴你',{exact:true})).toBeVisible();
  state.native(false);await expect(page.getByRole('img',{name:'小狒：陪伴',exact:true})).toBeVisible();
  await expect(pet).toHaveCount(0);
  await page.goto('/today');await expect(pet).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('拖到视口边缘仍保留完整角色和提示，不产生横向溢出',async({page})=>{
  await setup(page);await page.goto('/today');
  const pet=page.getByRole('region',{name:'网页小狒',exact:true});await expect(pet).toBeVisible();
  await pet.getByRole('button',{name:'小狒，点击聊天，拖动移动位置',exact:true}).hover();
  await page.mouse.down();await page.mouse.move(page.viewportSize()!.width-1,page.viewportSize()!.height-1,{steps:8});await page.mouse.up();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const caption=pet.locator('.web-pet-status');await expect(caption).toBeVisible();
  const box=(await caption.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('专注、完成庆祝和网页显示偏好保留',async({page})=>{
  const state=await setup(page),pet=page.getByRole('region',{name:'网页小狒',exact:true});
  await page.goto('/today');await expect(pet).toBeVisible();
  state.focus(true);await expect(pet.getByRole('img',{name:'小狒：学习',exact:true})).toBeVisible({timeout:12000});
  await expect(pet).toContainText('专注');
  state.focus(false);state.done();await expect(pet).toContainText('完成：复习英语',{timeout:12000});
  await pet.getByRole('button',{name:'隐藏网页小狒',exact:true}).click();await expect(pet).toHaveCount(0);
  await page.reload();await expect(pet).toHaveCount(0);
  await page.goto('/account');await page.locator('.preferences-companion > summary').click();await page.getByText('在网页显示小狒',{exact:true}).click();await expect(pet).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('连接中断时网页先隐藏，重新确认桌面未运行后才恢复',async({page})=>{
  const state=await setup(page);await page.goto('/today');
  const pet=page.getByRole('region',{name:'网页小狒',exact:true});await expect(pet).toBeVisible();
  await page.route('**/api/v1/auth/desktop-link/presence',route=>route.abort());
  await expect(pet).toHaveCount(0,{timeout:7000});
  await page.unroute('**/api/v1/auth/desktop-link/presence');
  await expect(pet).toBeVisible();expect(state.errors).toEqual([]);
});

test('设备没有 WebGL2 时自动使用 2D，网页仍可陪伴',async({page})=>{
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:any,...args:any[]){return type==='webgl2'?null:original.call(this,type,...args);} as typeof original;
  });
  const state=await setup(page);await page.goto('/today');
  const canvas=page.getByRole('region',{name:'网页小狒',exact:true}).getByRole('img');
  await expect(canvas).toHaveAttribute('data-ready','true');await expect(canvas).toHaveAttribute('data-renderer','two-dimensional');
  expect(state.errors).toEqual([]);
});
