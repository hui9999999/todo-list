import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('public/media');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage({viewport:{width:640,height:400},deviceScaleFactor:1});
  await page.route('**/pet-capture',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#f7f3eb}#pet{position:absolute;width:320px;height:320px;visibility:hidden}#record{display:block}</style><canvas id="pet"></canvas><canvas id="record" width="640" height="400"></canvas>'}));
  await page.goto('http://localhost:5174/pet-capture');
  const importUrl='/@fs/'+path.resolve('../desktop/sprite-renderer.mjs').replaceAll('\\','/');
  const recording=page.evaluate(async moduleUrl=>{
    const {createPetRenderer}=await import(moduleUrl),sprite=document.querySelector('#pet'),canvas=document.querySelector('#record'),ctx=canvas.getContext('2d');
    const pet=createPetRenderer(sprite);await pet.loaded;
    const recorder=new MediaRecorder(canvas.captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1200000});
    const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const done=new Promise(resolve=>recorder.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))));
    let start=performance.now();recorder.start();
    await new Promise(resolve=>{
      function tick(now){
        const t=(now-start)/1000;
        let target={kind:'idle',index:0,direction:1},x=100,label='站稳，准备出发';
        if(t<3.6){target={kind:'walking',index:1,direction:1};x=100+Math.max(0,t-.215)*25;label='双脚交替 · 向右走';}
        else if(t<4.1){x=184.625;label='停步 · 转身';}
        else if(t<7.7){target={kind:'walking',index:1,direction:-1};x=184.625-Math.max(0,t-4.315)*25;label='双脚交替 · 向左走';}
        else if(t<8.9){target={kind:'wave',index:14,direction:1};label='收势 · 挥手';}
        else if(t<10){target={kind:'celebrate',index:7,direction:1};label='下蹲 · 起跳 · 落地';}
        else {label='回到陪伴';}
        pet.draw(target,now,true);
        ctx.fillStyle='#f7f3eb';ctx.fillRect(0,0,640,400);
        ctx.fillStyle='rgba(88,72,45,.08)';ctx.beginPath();ctx.ellipse(x+160,323,60,8,0,0,Math.PI*2);ctx.fill();
        ctx.drawImage(sprite,x,35,320,320);
        ctx.fillStyle='#655a48';ctx.font='17px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillText(label,320,380);
        canvas.dataset.elapsed=String(t);
        if(t>=11.2){recorder.stop();pet.dispose();resolve();return;}
        requestAnimationFrame(tick);
      }requestAnimationFrame(tick);
    });
    return done;
  },importUrl);
  for(const [time,name] of [[1.5,'right-step'],[2.5,'other-foot'],[5.5,'left-step'],[8.4,'wave']]){
    await page.waitForFunction(t=>Number(document.querySelector('#record').dataset.elapsed)>=t,time);
    await page.screenshot({path:path.join(output,`xiaoqi-3d-${name}.png`)});
  }
  const bytes=await recording;await writeFile(path.join(output,'xiaoqi-3d-preview.webm'),Buffer.from(bytes));
  console.log(`Saved ${bytes.length} bytes to ${output}`);
}finally{await browser.close();}
