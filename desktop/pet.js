'use strict';
import {createPetRenderer} from './sprite-renderer.mjs';
import {HoverReactions,DragFacing,canHoverReact} from './interactions.mjs';
const pet=document.querySelector('#pet'),sprite=document.querySelector('#sprite'),status=document.querySelector('#status');
let renderer;
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const hover=new HoverReactions(),facing=new DragFacing();
let previousKind='',reminderHand='right';
let packet={options:{motion:true},state:{}},dragging=false,moved=false,start=null,temporaryUntil=0,temporaryIndex=0,temporaryKind='idle',lastInput=Date.now(),lastUpdate=Date.now();
function clock(seconds){return Math.floor(seconds/60).toString().padStart(2,'0')+':'+Math.max(0,seconds%60).toString().padStart(2,'0');}
function current(){
  const state=packet.state,now=Date.now();
  const reaction=hover.sample(now,temporaryUntil<=now && canHoverReact(packet,{now,dragging,pressed:!!start,reduced:reduced.matches}));
  if(hover.hovering)lastInput=now;
  if(dragging)return [8,'dragged','松开即可放下小狒'];
  if(temporaryUntil>now)return [temporaryIndex,temporaryKind,state.userId?'小狒陪着你':'点我登录工作台'];
  if(state.celebrateUntil>now)return [7,'celebrate',state.celebrateTitle?'完成：'+state.celebrateTitle:'又完成了一件事'];
  if(state.aiStatus==='thinking')return [6,'think','正在思考…'];
  if(state.aiStatus==='confirm')return [14,'remind','有任务变更待确认'];
  if(state.focus){if(state.focus.state==='paused')return [0,'idle','专注已暂停'];const remaining=Math.max(0,state.focus.remaining-Math.floor((now-lastUpdate)/1000));return [state.focus.scope==='study'?4:5,'focus','专注 '+clock(remaining)];}
  if(state.break){const remaining=state.break.state==='running'?Math.max(0,state.break.remaining-Math.floor((now-lastUpdate)/1000)):state.break.remaining;return [12,'rest',state.break.state==='paused'?'休息已暂停':'休息 '+clock(remaining)];}
  if(state.aiStatus==='error')return [14,'remind','打开聊天查看请求状态'];
  if(packet.walking)return [1,'walking','小狒散散步'];
  if(reaction)return [reaction.index,reaction.kind,reaction.label,reaction];
  if(state.userId&&!state.connected)return [0,'idle','暂时无法同步'];
  if(now-lastInput>120000)return [13,'sleep','小狒歇一会儿'];
  return [0,'idle',state.userId?'小狒陪着你':'点我登录工作台'];
}
function render(){
  if(!renderer)return;
  const [index,kind,label,reaction]=current();
  if(index===14 && kind!==previousKind && !reaction)reminderHand=Math.random()<.5?'left':'right';
  previousKind=kind;
  renderer.draw({index,kind,waveHand:reaction?.waveHand||reminderHand,renderStyle:packet.options.renderStyle||'3d',direction:kind==='walking'?packet.walkDirection||1:['dragged','landing'].includes(kind)?facing.direction:1,walkElapsed:kind==='walking'&&packet.walkStartedAt?Math.max(0,Date.now()-packet.walkStartedAt):undefined},performance.now(),packet.options.motion&&!reduced.matches);
  document.body.className=kind+(packet.options.motion?'':' motion-off');pet.dataset.action=kind;pet.dataset.reaction=reaction?.id||'';
  status.textContent=sprite.dataset.error?'动画暂时无法播放，点击打开工作台':label;
}
function update(value){packet=value;lastUpdate=Date.now();if(!renderer){renderer=createPetRenderer(sprite,packet.options.renderStyle||'3d');renderer.loaded.catch(()=>{});}const size=[120,160,200].includes(packet.options.size)?packet.options.size:160;document.documentElement.style.setProperty('--pet-size',size+'px');render();}
window.xiaoqiPet.onState(update);window.xiaoqiPet.snapshot().then(update);
function tick(){render();requestAnimationFrame(tick);}requestAnimationFrame(tick);
pet.addEventListener('pointerdown',event=>{if(event.button!==0)return;hover.cancel();lastInput=Date.now();start={x:event.screenX,y:event.screenY};facing.start(event.screenX);moved=false;dragging=false;pet.setPointerCapture(event.pointerId);window.xiaoqiPet.interactive(true);render();});
pet.addEventListener('pointermove',event=>{if(!start)return;facing.move(event.screenX);if(!dragging && Math.hypot(event.screenX-start.x,event.screenY-start.y)>5){dragging=true;moved=true;window.xiaoqiPet.drag('start',start);}if(dragging)window.xiaoqiPet.drag('move',{x:event.screenX,y:event.screenY});render();});
function finish(event){if(!start)return;if(dragging){if(event?.type==='pointerup')facing.move(event.screenX);window.xiaoqiPet.drag('end',event?.type==='pointerup'?{x:event.screenX,y:event.screenY}:undefined);temporaryIndex=9;temporaryKind='landing';temporaryUntil=Date.now()+650;}start=null;dragging=false;render();}
pet.addEventListener('pointerup',event=>{const open=start && !moved;finish(event);if(open)window.xiaoqiPet.command('chat');});pet.addEventListener('pointercancel',finish);pet.addEventListener('lostpointercapture',finish);
pet.addEventListener('contextmenu',event=>{event.preventDefault();hover.cancel();render();window.xiaoqiPet.command('menu');});
pet.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();window.xiaoqiPet.command('chat');}});
pet.addEventListener('pointerenter',()=>{lastInput=Date.now();hover.enter(lastInput);render();});
pet.addEventListener('pointerleave',()=>hover.leave());
status.addEventListener('click',()=>window.xiaoqiPet.command('chat'));status.addEventListener('contextmenu',event=>{event.preventDefault();window.xiaoqiPet.command('menu');});
document.addEventListener('mousemove',event=>{if(start)return;const over=event.target===pet||event.target===sprite||event.target===status;window.xiaoqiPet.interactive(over);});
window.addEventListener('blur',event=>{hover.cancel();finish(event);});


