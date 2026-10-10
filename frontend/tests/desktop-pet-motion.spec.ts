import {test,expect,_electron as electron} from '@playwright/test';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
test('原生步态交替、朝向、切换中间态与立即拖动',async({},info)=>{
  test.skip(info.project.name!=='desktop','原生窗口只验证一次');
  test.setTimeout(45000);
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});
  const root=path.resolve('..');
  const app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data}});
  try{
    await expect.poll(()=>app.windows().some(page=>page.url().startsWith('file:'))).toBe(true);
    const pet=app.windows().find(page=>page.url().startsWith('file:'))!;
    const chat=app.windows().find(page=>!page.url().startsWith('file:'))!;
    await expect.poll(()=>chat.url()).toContain('localhost:5174');await chat.waitForLoadState('load');
    const errors:string[]=[];pet.on('pageerror',e=>errors.push(e.message));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()!=='小狒桌宠')!.loadURL('about:blank'));
    const send=async(walking:boolean,direction=1,state:any={},motion=true)=>app.evaluate(({BrowserWindow},value)=>{
      BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.webContents.send('pet:state',value);
    },{options:{size:160,motion},state:{userId:'test',connected:true,aiStatus:'idle',...state},walking,walkDirection:direction});
    const sprite=pet.locator('#sprite');await expect(sprite).toHaveAttribute('data-ready','true');
    await expect(sprite).toHaveAttribute('data-renderer','three-dimensional');
    await send(true,-1);await expect(sprite).toHaveAttribute('data-phase','walking');await expect(sprite).toHaveAttribute('data-direction','-1');
    const frames=new Set();for(let i=0;i<24;i++){
      frames.add(await sprite.getAttribute('data-frame'));
      expect(Number(await sprite.getAttribute('data-hand-height'))-Number(await sprite.getAttribute('data-foot-height'))).toBeGreaterThan(.4);
      await pet.waitForTimeout(40);
    }
    expect(frames.has('rig:left-stance')).toBe(true);expect(frames.has('rig:right-stance')).toBe(true);
    const whiteRatio=await sprite.evaluate(el=>{
      const canvas=el as HTMLCanvasElement,ctx=canvas.getContext('2d')!;
      const {data}=ctx.getImageData(Math.round(canvas.width*.3),Math.round(canvas.height*.65),Math.round(canvas.width*.4),Math.round(canvas.height*.25));
      let white=0,opaque=0;for(let i=0;i<data.length;i+=4){if(data[i+3]!>250){opaque++;if(data[i]!>252&&data[i+1]!>252&&data[i+2]!>252)white++;}}
      return white/Math.max(1,opaque);
    });
    expect(whiteRatio).toBeLessThan(.01);
    await pet.locator('#pet').dispatchEvent('pointerenter');
    await expect(pet.locator('#pet')).toHaveAttribute('data-action','walking');
    await send(true,1);await expect(sprite).toHaveAttribute('data-direction','1');
    await expect(sprite).toHaveAttribute('data-phase','walking');
    await expect(sprite).toHaveAttribute('data-frame','rig:left-stance');
    await pet.screenshot({path:info.outputPath('walk-left-foot.png'),omitBackground:true});
    await expect(sprite).toHaveAttribute('data-frame','rig:right-stance');
    await pet.screenshot({path:info.outputPath('walk-right-foot.png'),omitBackground:true});
    await send(false,1,{focus:{state:'running',scope:'study',remaining:1200}});
    await expect(sprite).toHaveAttribute('data-phase','transition');
    await expect(sprite).toHaveAttribute('data-frame','base:4');
    await send(false,1,{aiStatus:'thinking'});await expect(sprite).toHaveAttribute('data-phase','transition');
    await send(false,1,{break:{state:'running',remaining:300}});await expect(sprite).toHaveAttribute('data-frame','base:12');
    const bounds=await pet.locator('#pet').boundingBox();await pet.mouse.move(bounds!.x+50,bounds!.y+50);await pet.mouse.down();await pet.mouse.move(bounds!.x+65,bounds!.y+65);
    await expect(pet.locator('#pet')).toHaveAttribute('data-action','dragged');await expect(sprite).toHaveAttribute('data-frame','base:8');await pet.mouse.up();
    await expect(pet.locator('#pet')).toHaveAttribute('data-action','landing');
    await send(false,1,{focus:{state:'running',scope:'study',remaining:1200}},false);
    await expect(sprite).toHaveAttribute('data-phase','settled');
    await expect(sprite).toHaveAttribute('data-frame','base:4');
    expect(await pet.locator('#pet').evaluate(el=>el.getBoundingClientRect().width)).toBe(160);
    expect(errors).toEqual([]);
  }finally{await app.close();}
});

