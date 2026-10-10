import {test,expect,_electron as electron} from '@playwright/test';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
test('连续触发动作、鼠标穿透和移动不会累积放大桌宠',async({},info)=>{
  test.setTimeout(120000);
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});
  const root=path.resolve('..');
  const app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data}});
  try{
    await expect.poll(()=>app.windows().some(page=>page.url().startsWith('file:'))).toBe(true);
    const pet=app.windows().find(page=>page.url().startsWith('file:'))!;
    const chat=app.windows().find(page=>!page.url().startsWith('file:'))!;
    await chat.waitForFunction(()=>Boolean(window.xiaoqiDesktop));
    await chat.evaluate(()=>window.xiaoqiDesktop!.setSettings({size:120,wander:false}));
    const geometry=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.getBounds());
    const initial=await geometry();
    await app.evaluate(({screen})=>{(screen as any).__petOriginalCursor=screen.getCursorScreenPoint;});
    const modes=['idle','remind','think','celebrate','dragged','landing','walking','rest','focus'];
    for(let round=0;round<4;round++){
      for(const mode of modes){
        await pet.evaluate(mode=>{document.body.className=mode;window.xiaoqiPet!.interactive(true);window.xiaoqiPet!.interactive(false);},mode);
        await pet.waitForTimeout(25);
        const bounds=await geometry();
        expect(Math.abs(bounds.width-initial.width)).toBeLessThanOrEqual(1);expect(Math.abs(bounds.height-initial.height)).toBeLessThanOrEqual(2);
        expect(await pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().width)).toBe(120);
      }
      await app.evaluate(({screen})=>{screen.getCursorScreenPoint=()=>({x:200,y:200});});
      await pet.evaluate(()=>window.xiaoqiPet!.drag('start'));
      for(let step=0;step<40;step++){
        await app.evaluate(({screen},step)=>{screen.getCursorScreenPoint=()=>({x:201+step,y:201+step});},step);
        await pet.evaluate(()=>window.xiaoqiPet!.drag('move'));
        const bounds=await geometry();expect(Math.abs(bounds.width-initial.width)).toBeLessThanOrEqual(1);expect(Math.abs(bounds.height-initial.height)).toBeLessThanOrEqual(2);
        expect(await pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().width)).toBe(120);
      }
      await pet.evaluate(()=>window.xiaoqiPet!.drag('end'));
      const moved=await geometry();
      expect(Math.abs(moved.width-initial.width)).toBeLessThanOrEqual(1);expect(Math.abs(moved.height-initial.height)).toBeLessThanOrEqual(2);
    }
    await app.evaluate(({screen})=>{screen.getCursorScreenPoint=(screen as any).__petOriginalCursor;});
    await chat.evaluate(()=>window.xiaoqiDesktop!.setSettings({wander:true,position:null}));
    await expect.poll(()=>pet.locator('#pet').getAttribute('data-action'),{timeout:40000,intervals:[100]}).toBe('walking');
    for(let step=0;step<15;step++){
      await pet.waitForTimeout(100);
      const bounds=await geometry();expect(Math.abs(bounds.width-initial.width)).toBeLessThanOrEqual(1);
      expect(await pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().width)).toBe(120);
    }
  }finally{await app.close();}
});
