<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,useId,watch} from 'vue';

const props=defineProps<{modelValue:number;max:number;label:string}>();
const emit=defineEmits<{'update:modelValue':[value:number]}>();
const scroller=ref<HTMLDivElement|null>(null),id='duration-'+useId();
const minutes=computed(()=>Array.from({length:props.max},(_,i)=>i+1));
const rowHeight=40;
let settleTimer:number|undefined;
const bounded=(value:number)=>Math.min(props.max,Math.max(1,Math.round(value)));
function currentValue(){return bounded((scroller.value?.scrollTop || 0)/rowHeight+1);}
function settle(){
  window.clearTimeout(settleTimer);
  const value=currentValue();emit('update:modelValue',value);return value;
}
function scroll(){window.clearTimeout(settleTimer);settleTimer=window.setTimeout(settle,120);}
function select(value:number){
  const next=bounded(value);emit('update:modelValue',next);
  scroller.value?.scrollTo({top:(next-1)*rowHeight,behavior:'auto'});
}
function keyboard(event:KeyboardEvent){
  const moves:Record<string,number>={ArrowUp:-1,ArrowDown:1,PageUp:-5,PageDown:5};
  if(event.key in moves){event.preventDefault();select(currentValue()+moves[event.key]!);}
  else if(event.key==='Home'||event.key==='End'){event.preventDefault();select(event.key==='Home'?1:props.max);}
}
watch(()=>props.modelValue,async value=>{
  await nextTick();
  if(currentValue()!==value)scroller.value?.scrollTo({top:(bounded(value)-1)*rowHeight,behavior:'auto'});
});
// Drawer content mounts before its overlay becomes visible, so scrolling must wait for that DOM update.
onMounted(async()=>{await nextTick();select(props.modelValue);});
onUnmounted(()=>window.clearTimeout(settleTimer));
defineExpose({settle});
</script>

<template>
  <div class="duration-wheel">
    <div class="duration-wheel-selection" aria-hidden="true"><span>分钟</span></div>
    <div ref="scroller" class="duration-wheel-scroll" role="listbox" tabindex="0" :aria-label="label" :aria-activedescendant="id+'-'+modelValue" @scroll.passive="scroll" @keydown="keyboard">
      <button v-for="minute in minutes" :id="id+'-'+minute" :key="minute" type="button" role="option" tabindex="-1" :aria-selected="minute===modelValue" :data-minute="minute" @click="select(minute)">{{minute}}</button>
    </div>
  </div>
</template>
