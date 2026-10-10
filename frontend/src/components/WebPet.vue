<script setup lang="ts">
import {computed,onBeforeUnmount,ref} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {useAuth} from '../stores/auth';
import {useDesktopPet} from '../stores/desktop-pet';
import {pageVisible} from '../pet-presence';
import PetSprite from './PetSprite.vue';

const auth=useAuth(),pet=useDesktopPet(),route=useRoute(),router=useRouter();
const viewport=ref({width:innerWidth,height:innerHeight}),now=ref(Date.now());
const size=computed(()=>viewport.value.width<=600?96:120);
const shown=computed(()=>auth.ready&&auth.user&&pet.webAllowed&&pageVisible.value&&route.path!=='/pet');
function clamp(point:{x:number;y:number}){
  const captionSpace=((viewport.value.width<=600?136:160)-size.value)/2;
  return {x:Math.round(Math.max(8+captionSpace,Math.min(point.x,viewport.value.width-size.value-captionSpace-8))),y:Math.round(Math.max(8,Math.min(point.y,viewport.value.height-size.value-46)))};
}
function initialPosition(){
  try{const point=JSON.parse(localStorage.getItem('todo-v2-web-pet-position')||'null');if(Number.isFinite(point?.x)&&Number.isFinite(point?.y))return clamp(point);}catch{/* Use a safe default position. */}
  return clamp({x:viewport.value.width-size.value-24,y:viewport.value.height-size.value-210});
}
const position=ref(initialPosition()),dragging=ref(false),direction=ref(1),reactionUntil=ref(0),landingUntil=ref(0);
let press:{x:number;y:number;position:{x:number;y:number};previousX:number}|null=null;
const timer=setInterval(()=>{now.value=Date.now();},250);
function clock(seconds:number){return Math.floor(seconds/60).toString().padStart(2,'0')+':'+Math.max(0,seconds%60).toString().padStart(2,'0');}
const pose=computed(()=>{
  const state=pet.petState;
  if(dragging.value)return {index:8,kind:'dragged',label:'拖动',status:'松开即可放下小狒'};
  if(landingUntil.value>now.value)return {index:9,kind:'landing',label:'落地',status:'小狒陪着你'};
  if(pet.celebrateUntil>now.value)return {index:7,kind:'celebrate',label:'庆祝',status:'完成：'+pet.celebrateTitle};
  if(state.aiStatus==='thinking')return {index:6,kind:'think',label:'思考',status:'正在思考…'};
  if(state.aiStatus==='confirm')return {index:14,kind:'remind',label:'招手',status:'有任务变更待确认'};
  if(state.focus){
    if(state.focus.state==='paused')return {index:0,kind:'idle',label:'陪伴',status:'专注已暂停'};
    const learning=state.focus.scope==='study';
    return {index:learning?4:5,kind:'focus',label:learning?'学习':'工作',status:'专注 '+clock(state.focus.remaining)};
  }
  if(state.break)return {index:12,kind:'rest',label:'喝水',status:state.break.state==='paused'?'休息已暂停':'休息 '+clock(state.break.remaining)};
  if(state.aiStatus==='error')return {index:14,kind:'remind',label:'招手',status:'打开聊天查看请求状态'};
  if(reactionUntil.value>now.value)return {index:14,kind:'remind',label:'招手',status:'一起把事情做好'};
  return {index:0,kind:'idle',label:'陪伴',status:state.connected?'小狒陪着你':'暂时无法同步'};
});
function down(event:PointerEvent){
  if(event.button!==0)return;
  press={x:event.clientX,y:event.clientY,previousX:event.clientX,position:{...position.value}};
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function move(event:PointerEvent){
  if(!press)return;
  const dx=event.clientX-press.x,dy=event.clientY-press.y;
  if(Math.hypot(dx,dy)>5)dragging.value=true;
  if(!dragging.value)return;
  if(Math.abs(event.clientX-press.previousX)>1)direction.value=event.clientX>press.previousX?1:-1;
  press.previousX=event.clientX;position.value=clamp({x:press.position.x+dx,y:press.position.y+dy});
}
function finish(event:PointerEvent){
  if(!press)return;
  const clicked=!dragging.value&&event.type==='pointerup';press=null;
  if(dragging.value){landingUntil.value=Date.now()+650;try{localStorage.setItem('todo-v2-web-pet-position',JSON.stringify(position.value));}catch{/* Drag still works without storage. */}}
  dragging.value=false;
  if(clicked)void router.push('/ai');
}
function resize(){viewport.value={width:innerWidth,height:innerHeight};position.value=clamp(position.value);}
window.addEventListener('resize',resize);
onBeforeUnmount(()=>{clearInterval(timer);window.removeEventListener('resize',resize);});
</script>

<template>
  <section v-if="shown" class="web-pet" role="region" aria-label="网页小狒" :data-action="pose.kind" :style="{left:position.x+'px',top:position.y+'px','--web-pet-size':size+'px'}">
    <button class="web-pet-hide" type="button" aria-label="隐藏网页小狒" title="隐藏，可在个人账户中重新开启" @click="pet.setWebEnabled(false)">×</button>
    <button class="web-pet-character" type="button" aria-label="小狒，点击聊天，拖动移动位置" @pointerdown="down" @pointermove="move" @pointerup="finish" @pointercancel="finish" @lostpointercapture="finish" @pointerenter="reactionUntil=Date.now()+1800" @click="event=>{if(event.detail===0)void router.push('/ai');}">
      <PetSprite :index="pose.index" :kind="pose.kind" :label="pose.label" :direction="direction" :render-style="pet.renderStyle" fallback-to2d/>
    </button>
    <button class="web-pet-status" type="button" title="和小狒聊天" @click="router.push('/ai')">{{pose.status}}</button>
  </section>
</template>

<style scoped>
.web-pet{position:fixed;width:var(--web-pet-size);z-index:1100;display:flex;flex-direction:column;align-items:center;user-select:none}
.web-pet-character{display:block;width:var(--web-pet-size);height:var(--web-pet-size);padding:0;border:0;background:transparent;cursor:grab;touch-action:none;border-radius:20px}
.web-pet-character:active{cursor:grabbing}.web-pet-character:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:3px}
.web-pet-character :deep(.pet-companion-sprite){width:100%;height:100%;pointer-events:none}
.web-pet-status{max-width:160px;min-height:28px;padding:4px 10px;margin-top:2px;border:1px solid var(--el-border-color);border-radius:16px;background:var(--el-bg-color);color:var(--el-text-color-regular);font:inherit;font-size:11px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.web-pet-hide{position:absolute;right:0;top:0;z-index:1;display:grid;place-items:center;width:24px;height:24px;padding:0;border:1px solid var(--el-border-color);border-radius:50%;background:var(--el-bg-color);color:var(--el-text-color-secondary);font-size:17px;cursor:pointer;opacity:0}
.web-pet:hover .web-pet-hide,.web-pet:focus-within .web-pet-hide{opacity:1}
@media(hover:none){.web-pet-hide{opacity:1}}
@media(max-width:600px){.web-pet-status{max-width:136px;font-size:10px}.web-pet-hide{width:28px;height:28px}}
</style>
