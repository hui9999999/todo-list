import {test,expect} from '@playwright/test';
test('工作台可找到小狒入口，预览动作并打开 Windows 桌宠',async({page},info)=>{
  await page.route('**/api/v1/**',route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith('/me'))return route.fulfill({json:{user:{id:'pet-page',email:'pet-page@example.com',timezone:'Asia/Shanghai',nickname:'小辉'},csrf_token:'test'}});
    if(p.endsWith('/settings'))return route.fulfill({json:{version:1,timezone:'Asia/Shanghai',theme:'warm',weather_enabled:false,notifications_enabled:false}});
    return route.fulfill({json:[]});
  });
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/today');
  await page.getByRole('navigation',{name:'工作区'}).getByRole('link',{name:'小狒桌宠',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'工作区'}).getByRole('link',{name:'小狒桌宠',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('region',{name:'小狒桌宠中心',exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'小狒：陪伴',exact:true})).toBeVisible();
  await page.getByRole('group',{name:'小狒动作预览'}).getByRole('button',{name:'庆祝',exact:true}).click();
  await expect(page.getByRole('img',{name:'小狒：庆祝',exact:true})).toBeVisible();
  const launch=new URL((await page.getByRole('link',{name:'打开 Windows 桌宠 ↗',exact:true}).getAttribute('href'))!);
  expect(launch.hostname).toBe('chat');
  expect(launch.searchParams.get('origin')).toBe('http://localhost:5174');
  await expect(page.getByText(/首次安装请先运行「启动小狒.cmd」/)).toBeVisible();
  await expect(page.getByRole('img',{name:'小狒：庆祝'})).toHaveAttribute('data-ready','true');
  await page.getByRole('button',{name:'漫步',exact:true}).click();
  const pet=page.getByRole('img',{name:'小狒：漫步'});
  await expect(pet).toHaveAttribute('data-phase','walking');
  const frames=new Set<string>();
  for(let i=0;i<20;i++){frames.add((await pet.getAttribute('data-frame'))!);await page.waitForTimeout(50);}
  expect(frames.has('rig:left-stance')).toBe(true);expect(frames.has('rig:right-stance')).toBe(true);
  await page.getByRole('button',{name:'学习',exact:true}).click();
  await expect(page.getByRole('img',{name:'小狒：学习'})).toHaveAttribute('data-phase','transition');
  await expect(page.getByRole('img',{name:'小狒：学习'})).toHaveAttribute('data-frame','base:4');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('pet-workbench.png'),fullPage:true});
  expect(errors).toEqual([]);
});

