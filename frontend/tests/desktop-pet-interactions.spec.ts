import {test,expect,_electron as electron} from '@playwright/test';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';

test('原生桌宠多种悬停、左右招手、拖动朝向与状态优先级，两种外观一致',async({},info)=>{
  test.skip(info.project.name!=='desktop','原生窗口只验证一次');
  test.setTimeout(90000);
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});
  await writeFile(path.join(data,'pet-preferences.json'),JSON.stringify({wander:false,motion:true}));
  const root=path.resolve('..');
  const app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data}});
  try{
    await expect.poll(()=>app.windows().some(page=>page.url().endsWith('/pet.html'))).toBe(true);
    const pet=app.windows().find(page=>page.url().endsWith('/pet.html'))!;
    await app.evaluate(({BrowserWindow})=>{
      for(const win of BrowserWindow.getAllWindows())if(win.getTitle()!=='小狒桌宠')void win.loadURL('about:blank');
    });
    await pet.addInitScript(()=>{
      const controls=window as any;controls.hoverNow=Date.now();controls.hoverRandom=0;
      Date.now=()=>controls.hoverNow;Math.random=()=>controls.hoverRandom;
    });
    const errors:string[]=[];pet.on('pageerror',error=>errors.push(error.message));
    const send=async(renderStyle:string,state:any={},motion=true,walking=false)=>app.evaluate(({BrowserWindow},value)=>{
      BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.webContents.send('pet:state',value);
    },{options:{size:160,motion,wander:false,renderStyle},state:{userId:'interaction-test',connected:true,aiStatus:'idle',...state},walking});
    const advance=async(ms:number)=>pet.evaluate(value=>{(window as any).hoverNow+=value;},ms);
    for(const style of ['3d','2d']){
      await pet.reload();await send(style);
      const button=pet.locator('#pet'),sprite=pet.locator('#sprite');
      await expect(sprite).toHaveAttribute('data-renderer',style==='3d'?'three-dimensional':'two-dimensional');
      for(const [random,id,index,hand] of [[0,'wave-right',14,'right'],[0,'stretch',10,''],[.3,'wave-left',14,'left'],[.4,'yawn',11,''],[.9,'drink',12,'']] as const){
        await pet.evaluate(value=>{(window as any).hoverRandom=value;},random);
        await button.dispatchEvent('pointerenter');await advance(200);
        await expect(button).toHaveAttribute('data-reaction',id);
        await expect(sprite).toHaveAttribute('data-frame','base:'+index);
        if(hand){
          await expect(sprite).toHaveAttribute('data-wave-hand',hand);
          if(style==='2d')await expect(sprite).toHaveAttribute('data-mirrored',String(hand==='left'));
          await pet.screenshot({path:info.outputPath(style+'-'+id+'.png'),omitBackground:true});
        }
        await button.dispatchEvent('pointerleave');await advance(9000);
        await expect(button).toHaveAttribute('data-reaction','');
      }
      for(const [state,action] of [[{focus:{state:'running',scope:'study',remaining:1200}},'focus'],[{break:{state:'running',remaining:300}},'rest'],[{aiStatus:'thinking'},'think'],[{aiStatus:'confirm'},'remind'],[{aiStatus:'error'},'remind']] as const){
        await send(style,state);await button.dispatchEvent('pointerenter');await advance(200);
        await expect(button).toHaveAttribute('data-action',action);
        await expect(button).toHaveAttribute('data-reaction','');await button.dispatchEvent('pointerleave');
      }
      await send(style,{},false);await button.dispatchEvent('pointerenter');await advance(200);
      await expect(button).toHaveAttribute('data-reaction','');await button.dispatchEvent('pointerleave');
      await send(style);await pet.emulateMedia({reducedMotion:'reduce'});
      await button.dispatchEvent('pointerenter');await advance(200);await expect(button).toHaveAttribute('data-reaction','');
      await button.dispatchEvent('pointerleave');await pet.emulateMedia({reducedMotion:'no-preference'});
      await pet.evaluate(()=>{
        const button=document.querySelector('#pet') as HTMLElement;button.setPointerCapture=()=>{};
        button.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,screenX:200,screenY:200,bubbles:true}));
        button.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,screenX:240,screenY:220,bubbles:true}));
      });
      await expect(button).toHaveAttribute('data-action','dragged');await expect(sprite).toHaveAttribute('data-direction','1');
      if(style==='3d')await expect.poll(async()=>Number(await sprite.getAttribute('data-yaw'))).toBeGreaterThan(.6);
      else await expect(sprite).toHaveAttribute('data-mirrored','true');
      await pet.screenshot({path:info.outputPath(style+'-drag-right.png'),omitBackground:true});
      await button.dispatchEvent('pointermove',{pointerId:1,screenX:220,screenY:230,bubbles:true});
      await expect(sprite).toHaveAttribute('data-direction','-1');
      if(style==='3d')await expect.poll(async()=>Number(await sprite.getAttribute('data-yaw'))).toBeLessThan(-.6);
      else await expect(sprite).toHaveAttribute('data-mirrored','false');
      await pet.screenshot({path:info.outputPath(style+'-drag-left.png'),omitBackground:true});
      await button.dispatchEvent('pointermove',{pointerId:1,screenX:220,screenY:245,bubbles:true});
      await expect(sprite).toHaveAttribute('data-direction','-1');
      await button.dispatchEvent('pointerup',{button:0,pointerId:1,screenX:220,screenY:245,bubbles:true});
      await expect(button).toHaveAttribute('data-action','landing');await expect(sprite).toHaveAttribute('data-direction','-1');
      await advance(700);await expect(button).toHaveAttribute('data-action','idle');
    }
    expect(errors).toEqual([]);
  }finally{await app.close();}
});
