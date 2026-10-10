import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page,{loggedIn=true,platform='Win32',disabled=false,delayTicket=false,enabled=true}={}){
  // Observe the launch URL without opening the operator's installed desktop app.
  await page.addInitScript(({platform,disabled,enabled})=>{
    Object.defineProperty(navigator,'platform',{get:()=>platform});
    Object.defineProperty(navigator,'webdriver',{get:()=>false});
    if(disabled)localStorage.setItem('todo-v2-desktop-auto-start','0');
    else if(enabled&&!localStorage.getItem('todo-v2-desktop-auto-start'))localStorage.setItem('todo-v2-desktop-auto-start','1');
    (window as any).desktopLaunches=[];
    const append=Node.prototype.appendChild;
    Node.prototype.appendChild=function<T extends Node>(child:T):T{
      if(child instanceof HTMLIFrameElement && child.dataset.desktopLaunch==='true'){
        (window as any).desktopLaunches.push(child.src);return child;
      }
      return append.call(this,child) as T;
    };
  },{platform,disabled,enabled});
  const session={user:{id:'auto-user',nickname:'自动启动测试',identifier:'auto@example.com',timezone:'Asia/Shanghai'},csrf_token:'auto-csrf'};
  const state={requests:0,release:()=>{}};
  const gate=new Promise<void>(resolve=>{state.release=resolve;});
  await page.route('**/api/v1/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith('/me'))return route.fulfill({status:loggedIn?200:401,json:loggedIn?session:{detail:'未登录'}});
    if(p.endsWith('/auth/login')){loggedIn=true;return route.fulfill({json:session});}
    if(p.endsWith('/auth/logout')){loggedIn=false;return route.fulfill({json:{message:'已退出'}});}
    if(p.endsWith('/auth/desktop-link')){
      state.requests++;
      expect(route.request().headers()['x-csrf-token']).toBe(session.csrf_token);
      if(delayTicket)await gate;
      return route.fulfill({status:201,json:{ticket:'a'.repeat(43)}});
    }
    if(p.endsWith('/settings'))return route.fulfill({json:{version:1,theme:'warm',weather_enabled:false,notifications_enabled:false}});
    if(p.endsWith('/account-profile'))return route.fulfill({json:{user:session.user,nickname_changes_remaining:2}});
    return route.fulfill({json:[]});
  });
  return state;
}
const launches=(page:Page)=>page.evaluate(()=>(window as any).desktopLaunches as string[]);

test('开启桌面自动启动后只启动一次，页面切换不重复，关闭偏好后刷新不启动',async({page})=>{
  const state=await setup(page);
  await page.goto('/tasks');
  await expect.poll(async()=>{
    const urls=await launches(page);
    return urls.map(value=>({origin:new URL(value).searchParams.get('origin'),ticket:new URL(value).searchParams.get('ticket')}));
  }).toEqual([{origin:'http://localhost:5174',ticket:'a'.repeat(43)}]);
  await page.getByRole('link',{name:'个人账户',exact:true}).last().click();
  await page.locator('.preferences-companion > summary').click();
  const toggle=page.getByRole('checkbox',{name:'打开网页时自动启动桌宠',exact:true});
  await expect(toggle).toBeChecked();
  expect(state.requests).toBe(1);
  await page.getByText('打开网页时自动启动桌宠',{exact:true}).click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await page.locator('.preferences-companion > summary').click();
  await expect(toggle).not.toBeChecked();
  expect(state.requests).toBe(1);
  expect(await launches(page)).toEqual([]);
  await page.getByText('打开网页时自动启动桌宠',{exact:true}).click();
  await expect.poll(()=>state.requests).toBe(2);
  await expect.poll(()=>launches(page)).toHaveLength(1);
});

test('默认使用免安装网页小狒，不发起 Windows 协议或账号绑定票据',async({page})=>{
  const state=await setup(page,{enabled:false});await page.goto('/account');
  await page.locator('.preferences-companion > summary').click();
  await expect(page.getByRole('region',{name:'网页小狒',exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'打开网页时自动启动桌宠',exact:true})).not.toBeChecked();
  expect(state.requests).toBe(0);expect(await launches(page)).toEqual([]);
});

test('未登录时不启动，登录成功后携带当前账号票据启动',async({page})=>{
  const state=await setup(page,{loggedIn:false});
  await page.goto('/auth');
  await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
  expect(state.requests).toBe(0);
  await page.getByRole('textbox',{name:'邮箱或电话号码',exact:true}).fill('auto@example.com');
  await page.getByLabel('密码',{exact:true}).fill('test-password-123');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect.poll(()=>launches(page)).toHaveLength(1);
  expect(state.requests).toBe(1);
});

test('退出时取消尚未返回的自动启动，避免绑定旧账号',async({page})=>{
  const state=await setup(page,{delayTicket:true});
  await page.goto('/account?tab=security');
  await expect.poll(()=>state.requests).toBe(1);
  await page.getByRole('button',{name:'退出当前账户',exact:true}).click();
  await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
  const response=page.waitForResponse('**/auth/desktop-link');
  state.release();await response;
  // Ensure the delayed promise has settled before asserting no protocol launch.
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
  expect(await launches(page)).toEqual([]);
});

test('非 Windows 浏览器不尝试启动本地桌宠',async({page})=>{
  const state=await setup(page,{platform:'Linux armv8l'});
  await page.goto('/account');
  await page.locator('.preferences-companion > summary').click();
  await expect(page.getByRole('region',{name:'小狒桌宠设置',exact:true})).toBeVisible();
  expect(state.requests).toBe(0);
  await expect(page.getByRole('checkbox',{name:'打开网页时自动启动桌宠',exact:true})).toHaveCount(0);
  expect(await launches(page)).toEqual([]);
});
