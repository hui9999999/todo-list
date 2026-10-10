import {test,expect,_electron as electron} from '@playwright/test';
import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';

test('快速拖动使用按下和移动时的坐标，后台延迟不会吞掉位移',async({},info)=>{
  test.skip(info.project.name!=='desktop','原生窗口只验证一次');
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});
  const root=path.resolve('..');
  const app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data}});
  try{
    await expect.poll(()=>app.windows().some(page=>page.url().endsWith('/pet.html'))).toBe(true);
    const pet=app.windows().find(page=>page.url().endsWith('/pet.html'))!;
    await pet.waitForLoadState('load');
    await expect(pet.locator('#sprite')).toHaveAttribute('data-ready','true');
    const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.getBounds());
    await app.evaluate(({BrowserWindow,screen})=>{
      const win=BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!;
      const area=screen.getPrimaryDisplay().workArea;
      win.setPosition(area.x+150,area.y+150);
      // All IPC handlers see the cursor after the gesture has already finished.
      screen.getCursorScreenPoint=()=>({x:400,y:400});
    });
    const before=await bounds();
    const errors:string[]=[];pet.on('pageerror',error=>errors.push(error.message));
    const action=await pet.evaluate(()=>{
      const pet=document.querySelector('#pet')!;
      // Synthetic pointers cannot acquire native capture.
      (pet as HTMLElement).setPointerCapture=()=>{};
      pet.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,screenX:200,screenY:200,bubbles:true}));
      pet.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,screenX:240,screenY:225,bubbles:true}));
      pet.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,screenX:260,screenY:235,bubbles:true}));
      pet.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:1,screenX:270,screenY:240,bubbles:true}));
      return (pet as HTMLElement).dataset.action;
    });
    expect(action).toBe('landing');
    await expect.poll(async()=>{const after=await bounds();return {x:after.x-before.x,y:after.y-before.y};}).toEqual({x:70,y:40});
    const after=await bounds();
    const saved=JSON.parse(await readFile(path.join(data,'pet-preferences.json'),'utf8'));
    expect(saved.position).toEqual({x:after.x,y:after.y});
    // Cancelled capture ends the gesture without treating cancellation's zero
    // coordinates as a real drop. A subsequent drag can start normally.
    await pet.evaluate(()=>{
      const pet=document.querySelector('#pet')!;
      pet.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:2,screenX:270,screenY:240,bubbles:true}));
      pet.dispatchEvent(new PointerEvent('pointermove',{pointerId:2,screenX:290,screenY:250,bubbles:true}));
      pet.dispatchEvent(new PointerEvent('pointercancel',{pointerId:2,bubbles:true}));
    });
    await expect.poll(async()=>{const next=await bounds();return {x:next.x-after.x,y:next.y-after.y};}).toEqual({x:20,y:10});
    const cancelled=await bounds();
    await pet.evaluate(()=>{
      const pet=document.querySelector('#pet')!;
      pet.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:3,screenX:290,screenY:250,bubbles:true}));
      pet.dispatchEvent(new PointerEvent('pointermove',{pointerId:3,screenX:270,screenY:240,bubbles:true}));
      pet.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:3,screenX:260,screenY:235,bubbles:true}));
    });
    await expect.poll(async()=>{const next=await bounds();return {x:next.x-cancelled.x,y:next.y-cancelled.y};}).toEqual({x:-30,y:-15});
    expect(errors).toEqual([]);
  }finally{await app.close();}
});
