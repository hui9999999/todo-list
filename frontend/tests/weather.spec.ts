import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page,enabled=true){
  let failing=true;const requests:string[]=[];
  await page.route('**/api/v1/**',route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');requests.push(path);let json:unknown=[];
    if(path==='/me')json={user:{id:'weather-user',email:'weather@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={version:1,theme:'warm',weather_enabled:enabled,weather_city:'娄底',notifications_enabled:false};
    if(path==='/auth/desktop-link/presence')json={desktop_active:true};
    if(path==='/weather')return failing?route.fulfill({status:502,json:{detail:'天气暂时无法获取，稍后可重试'}}):route.fulfill({json:{enabled:true,city:'娄底',current:{temperature_2m:23.5}}});
    return route.fulfill({json});
  });
  return {requests,succeed:()=>{failing=false;}};
}

test('今日显示天气失败原因，重试后显示城市和真实温度',async({page},info)=>{
  const mock=await setup(page);await page.goto('/today');
  const weather=page.getByRole('status',{name:'今日天气',exact:true});
  await expect(weather).toContainText('天气暂时无法获取，稍后可重试');
  await expect(page.getByRole('button',{name:'新建任务',exact:true})).toBeVisible();
  mock.succeed();await weather.getByRole('button',{name:'重试',exact:true}).click();
  await expect(weather).toContainText('娄底 · 23.5°C');
  await expect(weather.getByRole('link',{name:'更换城市',exact:true})).toBeVisible();
  await weather.getByRole('button',{name:'刷新天气',exact:true}).click();
  await expect(weather).toContainText('娄底 · 23.5°C');
  await page.screenshot({path:info.outputPath('today-weather.png'),fullPage:true,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('天气未开启时显示设置入口',async({page})=>{
  const mock=await setup(page,false);await page.goto('/today');
  const weather=page.getByRole('status',{name:'今日天气',exact:true});
  await expect(weather).toContainText('天气未开启');
  await expect(weather.getByRole('link',{name:'设置天气',exact:true})).toHaveAttribute('href','/account');
  expect(mock.requests.includes('/weather')).toBe(false);
});

for(const state of ['enabled','disabled','error'] as const){
  test(`四种周期清单保留同一天气栏且标题与标签位置稳定：${state}`,async({page},info)=>{
    const mock=await setup(page,state!=='disabled');
    if(state==='enabled')mock.succeed();
    const text=state==='enabled'?'娄底 · 23.5°C':state==='disabled'?'天气未开启':'天气暂时无法获取，稍后可重试';
    const weather=page.getByRole('status',{name:'今日天气',exact:true});
    const tabs=page.getByRole('navigation',{name:'清单周期',exact:true});
    const viewports=info.project.name==='mobile'?[{width:390,height:844},{width:320,height:844}]:[{width:1440,height:900}];
    for(const viewport of viewports){
      await page.setViewportSize(viewport);await page.goto('/today');
      await expect(weather).toContainText(text);
      const geometry=async()=>({
        metaHeight:(await page.locator('.today-meta').boundingBox())!.height,
        titleY:(await page.locator('.today-header h1').boundingBox())!.y,
        tabsY:(await tabs.boundingBox())!.y,
      });
      const before=await geometry();
      for(const title of ['本周清单','本月清单','年度清单','今日清单']){
        await tabs.getByRole('link',{name:title,exact:true}).click();
        await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
        await expect(weather).toContainText(text);
        await expect.poll(geometry).toEqual(before);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      }
    }
    expect(mock.requests.filter(path=>path==='/weather')).toHaveLength(state==='disabled'?0:viewports.length);
    await tabs.getByRole('link',{name:'年度清单',exact:true}).click();
    await page.screenshot({path:info.outputPath(`checklist-weather-${state}.png`),animations:'disabled'});
  });
}
