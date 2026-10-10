import {test,expect,_electron as electron} from '@playwright/test';
import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
test('桌宠大小修改后原生窗口和角色实际尺寸立即改变',async({},info)=>{
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});
  const root=path.resolve('..');
  const app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data}});
  try{
    await expect.poll(()=>app.windows().length).toBe(2);
    await expect.poll(()=>app.windows().some(page=>page.url().startsWith('file:'))).toBe(true);
    const pet=app.windows().find(page=>page.url().startsWith('file:'))!;
    const chat=app.windows().find(page=>!page.url().startsWith('file:'))!;
    await chat.waitForFunction(()=>Boolean(window.xiaoqiDesktop));
    for(const size of [120,200,160,120] as const){
      const saved=await chat.evaluate(size=>window.xiaoqiDesktop!.setSettings({size,wander:false}),size);
      expect(saved.size).toBe(size);
      const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.getBounds());
      expect(bounds.width).toBe(size+48);
      // Windows may add two DIP vertically when the resize border is locked.
      expect(Math.abs(bounds.height-(size+86))).toBeLessThanOrEqual(2);
      await expect.poll(()=>pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().width)).toBe(size);
      await expect.poll(()=>pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().height)).toBe(size);
      expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.isResizable())).toBe(false);
      expect(JSON.parse(await readFile(path.join(data,'pet-preferences.json'),'utf8')).size).toBe(size);
      if(size===120)await pet.screenshot({path:info.outputPath('pet-small.png'),omitBackground:true});
    }
  }finally{await app.close();}
  const restarted=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data}});
  try{
    await expect.poll(()=>restarted.windows().some(page=>page.url().startsWith('file:'))).toBe(true);
    const pet=restarted.windows().find(page=>page.url().startsWith('file:'))!;
    await expect.poll(()=>pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().width)).toBe(120);
  }finally{await restarted.close();}
});
