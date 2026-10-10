import {test,expect,_electron as electron} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';

test('浏览器可选择原版与立体版，刷新后保留选择并传给桌宠启动链接',async({page},info)=>{
  await page.route('**/api/v1/**',route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith('/me'))return route.fulfill({json:{user:{id:'style-user',nickname:'小辉',timezone:'Asia/Shanghai'},csrf_token:'test'}});
    if(p.endsWith('/settings'))return route.fulfill({json:{version:1,theme:'warm',weather_enabled:false,notifications_enabled:false}});
    return route.fulfill({json:[]});
  });
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/pet');
  const choice=page.getByRole('group',{name:'桌宠版本',exact:true}),sprite=page.getByRole('img',{name:'小狒：陪伴',exact:true});
  await expect(sprite).toHaveAttribute('data-renderer','three-dimensional');
  await choice.getByRole('button',{name:'2D 原版',exact:true}).click();
  await expect(sprite).toHaveAttribute('data-renderer','two-dimensional');
  const launch=new URL((await page.getByRole('link',{name:'打开 Windows 桌宠 ↗',exact:true}).getAttribute('href'))!);
  expect(launch.searchParams.get('origin')).toBe('http://localhost:5174');
  expect(launch.searchParams.get('renderStyle')).toBe('2d');
  await page.getByRole('button',{name:'漫步',exact:true}).click();
  const walking=page.getByRole('img',{name:'小狒：漫步',exact:true});await expect(walking).toHaveAttribute('data-phase','walking');
  const frames=new Set();for(let i=0;i<20;i++){frames.add(await walking.getAttribute('data-frame'));await expect(walking).toHaveAttribute('data-source-clipped','false');await page.waitForTimeout(75);}
  expect(frames.size).toBeGreaterThanOrEqual(6);
  await page.screenshot({path:info.outputPath('pet-2d.png'),fullPage:true});
  await page.reload();await expect(choice.getByRole('button',{name:'2D 原版',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(sprite).toHaveAttribute('data-renderer','two-dimensional');
  await choice.getByRole('button',{name:'3D 立体',exact:true}).click();await expect(sprite).toHaveAttribute('data-renderer','three-dimensional');
  await expect(choice.getByRole('button',{name:'3D 立体',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('Windows 版本即时切换、固定大小、预览同步与重启记忆',async({},info)=>{
  test.skip(info.project.name!=='desktop','原生窗口只验证一次');test.setTimeout(60000);
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});const root=path.resolve('..');
  const launch=()=>electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data}});
  let app=await launch();
  try{
    await expect.poll(()=>app.windows().some(page=>page.url().startsWith('file:'))).toBe(true);
    const pet=app.windows().find(page=>page.url().startsWith('file:'))!,chat=app.windows().find(page=>!page.url().startsWith('file:'))!;
    await expect.poll(()=>chat.url()).toContain('localhost:5174');await chat.waitForLoadState('load');
    await chat.route('**/api/v1/**',route=>{
      const p=new URL(route.request().url()).pathname;
      if(p.endsWith('/me'))return route.fulfill({json:{user:{id:'native-style',nickname:'小辉',timezone:'Asia/Shanghai'},csrf_token:'test'}});
      if(p.endsWith('/settings'))return route.fulfill({json:{version:1,theme:'warm',weather_enabled:false,notifications_enabled:false}});
      return route.fulfill({json:[]});
    });
    await chat.reload();await pet.locator('#pet').click();await chat.evaluate(()=>window.xiaoqiDesktop!.setSettings({size:120,wander:false,motion:true}));
    await chat.goto('http://localhost:5174/account');
    await chat.locator('.preferences-companion > summary').click();
    const geometry=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.getBounds());
    const originalPosition=await geometry();
    const choice=chat.getByRole('region',{name:'小狒桌宠设置',exact:true}).getByRole('group',{name:'桌宠版本',exact:true}),sprite=pet.locator('#sprite');
    await choice.getByRole('button',{name:'2D 原版',exact:true}).click();await expect(sprite).toHaveAttribute('data-renderer','two-dimensional');
    expect((await sprite.evaluate(el=>{const canvas=el as HTMLCanvasElement;return canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.filter((_,index)=>index%4===3).filter(alpha=>alpha>128).length;}))).toBeGreaterThan(1000);
    const width=await pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().width);expect(width).toBe(120);
    await pet.screenshot({path:info.outputPath('native-2d.png'),omitBackground:true});
    await chat.goto('http://localhost:5174/pet');
    const preview=chat.getByRole('img',{name:'小狒：陪伴',exact:true}),picker=chat.getByRole('group',{name:'桌宠版本',exact:true});
    await expect(preview).toHaveCount(0);
    await expect(chat.getByText('小狒正在桌面陪伴你',{exact:true})).toBeVisible();
    for(const [label,renderer] of [['3D 立体','three-dimensional'],['2D 原版','two-dimensional']] as const){
      await picker.getByRole('button',{name:label,exact:true}).click();await expect(sprite).toHaveAttribute('data-renderer',renderer);await expect(preview).toHaveCount(0);
      expect(await pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().width)).toBe(width);
      const current=await geometry();expect(Math.abs(current.x-originalPosition.x)).toBeLessThanOrEqual(1);expect(Math.abs(current.y-originalPosition.y)).toBeLessThanOrEqual(1);
    }
    await chat.evaluate(()=>window.xiaoqiDesktop!.setSettings({visible:false}));
    await expect(preview).toHaveAttribute('data-renderer','two-dimensional');
    await picker.getByRole('button',{name:'3D 立体',exact:true}).click();await expect(preview).toHaveAttribute('data-renderer','three-dimensional');
    await picker.getByRole('button',{name:'2D 原版',exact:true}).click();await expect(preview).toHaveAttribute('data-renderer','two-dimensional');
    await chat.evaluate(()=>window.xiaoqiDesktop!.setSettings({visible:true}));await expect(preview).toHaveCount(0);
    expect(JSON.parse(await readFile(path.join(data,'pet-preferences.json'),'utf8')).renderStyle).toBe('2d');
    await app.close();app=await launch();
    await expect.poll(()=>app.windows().some(page=>page.url().startsWith('file:'))).toBe(true);
    const restored=app.windows().find(page=>page.url().startsWith('file:'))!;await expect(restored.locator('#sprite')).toHaveAttribute('data-renderer','two-dimensional');
    expect(await restored.locator('#pet').evaluate(el=>el.getBoundingClientRect().width)).toBe(120);
  }finally{await app.close();}
});
