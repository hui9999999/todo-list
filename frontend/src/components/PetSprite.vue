<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {createPetRenderer} from '../../../desktop/sprite-renderer.mjs';
const props=defineProps<{index:number;label:string;kind:string;renderStyle?:'2d'|'3d';direction?:number;waveHand?:'left'|'right';fallbackTo2d?:boolean}>();
const canvas=ref<HTMLCanvasElement>(),error=ref(false),fallback=ref(false);let request=0,dispose:()=>void=()=>{};
watch(()=>props.renderStyle,()=>{fallback.value=false;});
onMounted(()=>{
  if(!canvas.value)return;
  let renderer:ReturnType<typeof createPetRenderer>;
  try{renderer=createPetRenderer(canvas.value,props.renderStyle||'3d');}catch{error.value=true;return;}
  dispose=renderer.dispose;const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function failed(){if(props.fallbackTo2d&&props.renderStyle!=='2d'&&!fallback.value){fallback.value=true;error.value=false;}else error.value=true;}
  renderer.loaded.catch(failed);
  function tick(now:number){
    try{renderer.draw({index:props.index,kind:props.kind,direction:props.direction||1,waveHand:props.waveHand,renderStyle:fallback.value?'2d':props.renderStyle||'3d'},now,!reduced.matches);}catch{failed();}
    if(canvas.value?.dataset.error)failed();else error.value=false;
    request=requestAnimationFrame(tick);
  }
  request=requestAnimationFrame(tick);
});
onBeforeUnmount(()=>{cancelAnimationFrame(request);dispose();});
</script>
<template><canvas ref="canvas" class="pet-companion-sprite" role="img" :aria-label="'小狒：'+label"/><span v-if="error" role="alert">动画暂时无法播放</span></template>
<style scoped>.pet-companion-sprite{display:block;width:250px;height:250px}@media(max-width:600px){.pet-companion-sprite{width:230px;height:230px}}</style>

