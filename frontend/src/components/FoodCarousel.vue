<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {ArrowLeft, ArrowRight, VideoPause, VideoPlay} from '@element-plus/icons-vue';
import type {Food} from '../food-catalog';
import {preloadFoodImage} from '../food-images';

const props=defineProps<{food?:Food; foods:Food[]; mealName:string; disabled:boolean; playing:boolean}>();
const emit=defineEmits<{
  step:[direction:1|-1,manual:boolean];
  'update:playing':[value:boolean];
}>();
const root=ref<HTMLElement>(), playback=ref<HTMLButtonElement>(), visible=ref(false), direction=ref<1|-1>(1);
const position=computed(()=>props.food?props.foods.findIndex(food=>food.id===props.food!.id)+1:0);
let timer=0, observer:IntersectionObserver|undefined, motion:MediaQueryList|undefined;
let touchStart:{x:number;y:number}|undefined;
function startSwipe(event:PointerEvent) {if(event.pointerType==='touch')touchStart={x:event.clientX,y:event.clientY};}
function finishSwipe(event:PointerEvent) {
  if(!touchStart)return;
  const x=event.clientX-touchStart.x,y=event.clientY-touchStart.y;touchStart=undefined;
  if(Math.abs(x)>=48 && Math.abs(x)>Math.abs(y)*1.2)advance(x<0?1:-1);
}
function advance(value:1|-1,manual=true) {
  if(props.disabled)return;
  direction.value=value;
  if(manual)emit('update:playing',false);
  emit('step',value,manual);
}
function updateMotion() {emit('update:playing',!motion?.matches);}
function hideLeavingImage(element:Element) {
  element.setAttribute('aria-hidden','true');
  element.setAttribute('alt','');
  element.classList.remove('carousel-current');
}
watch(()=>props.food?.id,()=>{
  const current=props.foods.findIndex(food=>food.id===props.food?.id);
  if(current<0)return;
  for(const offset of [-1,1]) {
    const food=props.foods[(current+offset+props.foods.length)%props.foods.length];
    if(food)void preloadFoodImage(food.image).catch(()=>{});
  }
},{immediate:true});
onMounted(()=>{
  motion=matchMedia('(prefers-reduced-motion: reduce)');
  updateMotion();motion.addEventListener('change',updateMotion);
  observer=new IntersectionObserver(entries=>{visible.value=entries.some(entry=>entry.isIntersecting);},{threshold:0.25});
  if(root.value)observer.observe(root.value);
  timer=window.setInterval(()=>{
    const card=root.value?.closest('.meal-card');
    // The play control must not immediately pause the playback it just enabled.
    const browsing=(card?.matches(':hover') && !playback.value?.matches(':hover')) ||
      (card?.matches(':focus-within') && document.activeElement!==playback.value);
    if(props.playing && !props.disabled && visible.value && document.visibilityState==='visible' && !browsing)advance(1,false);
  },5000);
});
onUnmounted(()=>{window.clearInterval(timer);observer?.disconnect();motion?.removeEventListener('change',updateMotion);});
</script>

<template>
  <div ref="root" class="meal-carousel" role="group" aria-roledescription="轮播" :aria-label="mealName+'菜品轮播'" tabindex="0" @keydown.left.prevent="advance(-1)" @keydown.right.prevent="advance(1)" @pointerdown="startSwipe" @pointerup="finishSwipe" @pointercancel="touchStart=undefined">
    <Transition :name="direction===1?'food-forward':'food-backward'" :duration="700" @before-leave="hideLeavingImage">
      <img v-if="food" :key="food.id" class="carousel-current" :src="food.image" :alt="food.name" width="1254" height="1254"/>
    </Transition>
    <button type="button" class="carousel-arrow previous" :aria-label="mealName+'上一道'" :disabled="disabled" @click="advance(-1)"><ArrowLeft/></button>
    <button type="button" class="carousel-arrow next" :aria-label="mealName+'下一道'" :disabled="disabled" @click="advance(1)"><ArrowRight/></button>
    <span class="carousel-position" :aria-label="'第 '+position+' 道，共 '+foods.length+' 道'">{{position}} / {{foods.length}}</span>
    <button ref="playback" type="button" class="carousel-play" :aria-label="(playing?'暂停':'播放')+mealName+'轮播'" :aria-pressed="playing" :disabled="disabled" @click="emit('update:playing',!playing)"><VideoPause v-if="playing"/><VideoPlay v-else/><span>{{playing?'自动播放':'已暂停'}}</span></button>
  </div>
</template>

<style scoped>
.meal-carousel{position:relative;overflow:hidden;aspect-ratio:1;background:var(--el-fill-color-light);touch-action:pan-y}
.meal-carousel img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;z-index:1;will-change:opacity,transform}
.food-forward-enter-active,.food-forward-leave-active,.food-backward-enter-active,.food-backward-leave-active{transition:opacity .7s cubic-bezier(.22,1,.36,1),transform .7s cubic-bezier(.22,1,.36,1)}
.food-forward-enter-from{opacity:0;transform:translateX(3%) scale(1.025)}.food-forward-leave-to{opacity:0;transform:translateX(-3%) scale(1.015)}
.food-backward-enter-from{opacity:0;transform:translateX(-3%) scale(1.025)}.food-backward-leave-to{opacity:0;transform:translateX(3%) scale(1.015)}
.food-forward-leave-active,.food-backward-leave-active{z-index:0}
.carousel-arrow,.carousel-play,.carousel-position{background:color-mix(in srgb,var(--el-bg-color) 92%,transparent);color:var(--el-text-color-primary);border:1px solid var(--el-border-color-light)}
.carousel-arrow,.carousel-play{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .18s,transform .18s}
.carousel-arrow{top:50%;width:38px;height:38px;border-radius:50%;transform:translateY(-50%)}
.carousel-arrow.previous{left:12px}.carousel-arrow.next{right:12px}
.carousel-arrow svg{width:18px;height:18px}.carousel-arrow:hover,.carousel-play:hover{background:var(--el-bg-color)}
.carousel-arrow:active{transform:translateY(-50%) scale(.95)}.carousel-play:active{transform:scale(.97)}
.carousel-position{position:absolute;z-index:2;bottom:12px;left:12px;border-radius:6px;padding:6px 10px;font-size:12px;line-height:20px;font-variant-numeric:tabular-nums}
.carousel-play{right:12px;bottom:12px;gap:5px;border-radius:6px;padding:6px 10px;font-size:12px;line-height:20px}
.carousel-play svg{width:15px;height:15px}
button:disabled{cursor:default;opacity:.5}.meal-carousel:focus-visible,button:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:-3px}
@media(max-width:760px){.meal-carousel{aspect-ratio:4/3;max-height:360px}.carousel-arrow{width:40px;height:40px}}
@media(max-width:760px){
  .meal-carousel img{height:100%;aspect-ratio:auto;max-height:none}
  .carousel-arrow{top:50%;width:44px;height:44px;border-radius:5px;background:transparent;border:0;color:#fff;text-shadow:0 1px 3px #000}
  .carousel-arrow svg{filter:drop-shadow(0 1px 2px #333);width:20px;height:20px}
  .carousel-arrow.previous{left:0}.carousel-arrow.next{right:0}
  .carousel-arrow:hover{background:rgb(0 0 0 / .14)}
  .carousel-play{right:0;bottom:0;width:44px;height:44px;padding:0;border:0;border-radius:7px 0 0 0}
  .carousel-play span{display:none}.carousel-play svg{width:18px;height:18px}
  .carousel-position{left:4px;bottom:5px;padding:2px 4px;font-size:10px;line-height:18px;border:0}
}
@media(prefers-reduced-motion:reduce){.meal-carousel img{transition:none;transform:none}.carousel-arrow,.carousel-play{transition:none}.carousel-arrow:active{transform:translateY(-50%)}.carousel-play:active{transform:none}}
</style>
