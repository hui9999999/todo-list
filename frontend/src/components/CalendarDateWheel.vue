<script setup lang="ts">
import {computed} from 'vue';
import {calendarDateParts,monthDays,shiftCalendarDate,type CalendarDateUnit} from '../calendar-date';
const props=defineProps<{modelValue:string}>();
const emit=defineEmits<{'update:modelValue':[value:string]}>();
const parts=computed(()=>calendarDateParts(props.modelValue));
const units=[{id:'year',label:'年'},{id:'month',label:'月'},{id:'day',label:'日'}] as const;
const offsets=[-2,-1,0,1,2];
const rows=(unit:CalendarDateUnit)=>offsets.map(offset=>{
  const date=shiftCalendarDate(props.modelValue,unit,offset);
  return {date,offset,value:calendarDateParts(date)[unit]};
});
const limits=(unit:CalendarDateUnit)=>unit==='year'?9999:unit==='month'?12:monthDays(parts.value.year,parts.value.month);
function choose(value:string) {if(value!==props.modelValue)emit('update:modelValue',value);}
function step(unit:CalendarDateUnit,amount:number) {choose(shiftCalendarDate(props.modelValue,unit,amount));}
const wheels=new Map<CalendarDateUnit,{delta:number;last:number}>();
function wheel(event:WheelEvent,unit:CalendarDateUnit) {
  if(event.ctrlKey || !event.deltaY || Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  event.preventDefault();
  const state=wheels.get(unit) || {delta:0,last:-Infinity};wheels.set(unit,state);
  state.delta+=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?180:1);
  if(Math.abs(state.delta)<40)return;
  const direction=Math.sign(state.delta);state.delta=0;
  if(event.timeStamp-state.last<100)return;
  state.last=event.timeStamp;step(unit,direction);
}
function key(event:KeyboardEvent,unit:CalendarDateUnit) {
  const amounts:Record<string,number>={ArrowUp:-1,ArrowDown:1,PageUp:-5,PageDown:5};
  if(event.key in amounts){event.preventDefault();step(unit,amounts[event.key]!);}
  else if(event.key==='Home' || event.key==='End'){
    event.preventDefault();step(unit,(event.key==='Home'?1:limits(unit))-parts.value[unit]);
  }
}
let drag:{id:number;unit:CalendarDateUnit;date:string;y:number;steps:number}|null=null;
let dragged=false;
function pointerDown(event:PointerEvent,unit:CalendarDateUnit) {
  dragged=false;
  if(event.pointerType!=='touch' && event.pointerType!=='pen')return;
  drag={id:event.pointerId,unit,date:props.modelValue,y:event.clientY,steps:0};
  try{(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);}catch{/* Synthetic test pointers have no active capture. */}
}
function pointerMove(event:PointerEvent) {
  if(!drag || event.pointerId!==drag.id)return;
  const distance=drag.y-event.clientY,steps=Math.trunc(distance/36);
  if(Math.abs(distance)>6)dragged=true;
  if(steps===drag.steps)return;
  drag.steps=steps;choose(shiftCalendarDate(drag.date,drag.unit,steps));
}
function pointerEnd(event:PointerEvent) {
  if(event.pointerId===drag?.id)drag=null;
}
function clickRow(date:string) {if(dragged){dragged=false;return;}choose(date);}
</script>

<template>
  <div class="calendar-date-wheel" role="group" aria-label="年月日滚轮">
    <p class="date-wheel-help">在年、月、日上滚动选择，也可滑动或使用 ↑ ↓ 键。</p>
    <div class="date-wheel-columns">
      <div v-for="unit in units" :key="unit.id" class="date-wheel-column">
        <span class="date-wheel-label">{{unit.label}}</span>
        <div class="date-wheel-track" role="spinbutton" tabindex="0" :aria-label="'选择'+unit.label" :aria-valuemin="1" :aria-valuemax="limits(unit.id)" :aria-valuenow="parts[unit.id]" :aria-valuetext="`${parts[unit.id]} ${unit.label}`"
          @wheel="wheel($event,unit.id)" @keydown="key($event,unit.id)" @pointerdown="pointerDown($event,unit.id)" @pointermove="pointerMove" @pointerup="pointerEnd" @pointercancel="pointerEnd">
          <button v-for="row in rows(unit.id)" :key="row.offset" type="button" tabindex="-1" class="date-wheel-value" :class="{'date-wheel-selected':row.offset===0,'date-wheel-far':Math.abs(row.offset)===2}" :aria-label="'选择 '+row.date" :disabled="row.offset!==0 && row.date===modelValue" @click="clickRow(row.date)">{{unit.id==='year'?row.value:String(row.value).padStart(2,'0')}}</button>
        </div>
      </div>
    </div>
    <output class="date-wheel-result" aria-live="polite" aria-label="已选日期">{{modelValue}}</output>
  </div>
</template>

<style scoped>
.date-wheel-help{font-size:12px;line-height:1.7;color:var(--el-text-color-secondary);margin:0 0 20px}.date-wheel-columns{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:12px}.date-wheel-column{min-width:0;text-align:center}.date-wheel-label{font-size:12px;color:var(--el-text-color-secondary);display:block;margin-bottom:12px}.date-wheel-track{touch-action:none;user-select:none;overscroll-behavior:contain;border:1px solid var(--el-border-color-light);border-radius:10px;background:var(--el-fill-color-blank);overflow:hidden;padding:4px 0}.date-wheel-track:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:3px}.date-wheel-value{display:block;width:100%;height:36px;border:0;padding:0;background:transparent;font:inherit;font-size:17px;font-variant-numeric:tabular-nums;color:var(--el-text-color-secondary);cursor:pointer}.date-wheel-far{opacity:.45}.date-wheel-selected{color:var(--el-color-primary);background:var(--el-color-primary-light-9);font-size:22px;font-weight:600;border-top:1px solid var(--el-border-color-light);border-bottom:1px solid var(--el-border-color-light)}.date-wheel-value:not(.date-wheel-selected):hover{background:var(--el-fill-color-light)}.date-wheel-value:disabled{cursor:default}.date-wheel-result{display:block;text-align:center;font-size:14px;font-variant-numeric:tabular-nums;color:var(--el-text-color-primary);margin:20px 0 0}@media(max-width:400px){.date-wheel-columns{gap:8px}.date-wheel-value{font-size:16px}.date-wheel-selected{font-size:20px}}
</style>
