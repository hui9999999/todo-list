<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {Refresh, Check, Close} from '@element-plus/icons-vue';
import {api, post} from '../api';
import {useAuth} from '../stores/auth';
import {localDate} from '../stores/tasks';
import type {Memory} from '../advanced-types';
import FoodCarousel from './FoodCarousel.vue';
import {foods, meals, foodGroups, pickFood, choiceKey, choiceContent, readChoices, type Food, type FoodGroup, type Meal} from '../food-catalog';
import {preloadFoodImage} from '../food-images';

const auth=useAuth();
const today=()=>localDate(auth.user?.timezone || 'Asia/Shanghai');
const day=ref(today()), loading=ref(true), ready=ref(false), error=ref('');
const candidates=ref<Partial<Record<Meal,Food>>>({});
const emptyMenu=():Record<Meal,Food[]>=>({breakfast:[],lunch:[],dinner:[]});
const confirmed=ref(emptyMenu()), previewLoading=ref<Record<Meal,boolean>>({breakfast:false,lunch:false,dinner:false}), removing=ref('');
const pendingFoods=ref<Partial<Record<Meal,Food>>>({});
const saving=ref<Meal|null>(null);
const librarySaving=ref(''), libraryNotice=ref('');
const category=ref<FoodGroup|'all'>('all');
const libraryGroups=foodGroups.map(group=>({...group,foods:foods.filter(food=>food.group===group.id)}));
const categories=[{id:'all',name:'全部',count:foods.length},...libraryGroups.map(group=>({id:group.id,name:group.name,count:group.foods.length}))] as const;
const galleryGroups=computed(()=>libraryGroups.filter(group=>category.value==='all' || group.id===category.value));
const savingBusy=computed(()=>loading.value || !ready.value || !!saving.value);
const busy=computed(()=>savingBusy.value || Object.values(previewLoading.value).some(Boolean));
const playing=ref<Record<Meal,boolean>>({breakfast:true,lunch:true,dinner:true});
const breakfastFoods=foods.filter(food=>food.category==='breakfast'), mainFoods=foods.filter(food=>food.category==='main');
const mealFoods=(meal:Meal)=>meal==='breakfast'?breakfastFoods:mainFoods;
const menuCount=computed(()=>meals.reduce((total,meal)=>total+confirmed.value[meal.id].length,0));
const inMenu=(meal:Meal,food?:Food)=>!!food && confirmed.value[meal].some(item=>item.id===food.id);
let generation=0, clock=0;
async function showCandidate(meal:Meal,food:Food) {
  const token=generation;
  previewLoading.value[meal]=true;pendingFoods.value[meal]=food;
  try {
    await preloadFoodImage(food.image);
    if(token===generation)candidates.value[meal]=food;
  } catch(e) {if(token===generation){playing.value[meal]=false;error.value=(e as Error).message;}}
  finally {if(token===generation){previewLoading.value[meal]=false;delete pendingFoods.value[meal];}}
}
function draw(meal:Meal) {
  if(busy.value)return;
  playing.value[meal]=false;
  const other=meal==='lunch'?'dinner':'lunch';
  return showCandidate(meal,pickFood(meal,[candidates.value[meal]?.id || '', ...(meal==='breakfast'?[]:[candidates.value[other]?.id || ''])]));
}
async function drawAll() {
  if(busy.value)return;
  const token=generation;
  playing.value={breakfast:false,lunch:false,dinner:false};
  for(const meal of meals){if(token!==generation)return;await draw(meal.id);}
}
async function select(meal:Meal,food:Food) {
  if(busy.value || inMenu(meal,food))return;
  const token=generation;
  librarySaving.value=meal+':'+food.id;libraryNotice.value='';
  const saved=await saveMenu(meal,[...confirmed.value[meal],food]);
  if(token===generation) {
    librarySaving.value='';
    libraryNotice.value=saved?'':food.name+'添加失败，请重试。';
  }
}
function step(meal:Meal,direction:1|-1,manual:boolean) {
  if(savingBusy.value || previewLoading.value[meal])return;
  if(manual)playing.value[meal]=false;
  const pool=mealFoods(meal), current=pool.findIndex(food=>food.id===candidates.value[meal]?.id);
  const other=meal==='lunch'?'dinner':'lunch';
  for(let offset=1;offset<=pool.length;offset++) {
    const food=pool[(current+direction*offset+pool.length)%pool.length]!;
    if(meal==='breakfast' || (food.id!==candidates.value[other]?.id && food.id!==pendingFoods.value[other]?.id))return showCandidate(meal,food);
  }
}
async function load() {
  const token=++generation;
  loading.value=true;ready.value=false;error.value='';saving.value=null;
  confirmed.value=emptyMenu();removing.value='';
  librarySaving.value='';libraryNotice.value='';
  previewLoading.value={breakfast:false,lunch:false,dinner:false};
  pendingFoods.value={};
  const autoplay=!matchMedia('(prefers-reduced-motion: reduce)').matches;
  playing.value={breakfast:autoplay,lunch:autoplay,dinner:autoplay};
  candidates.value={breakfast:pickFood('breakfast'),lunch:pickFood('lunch')};
  candidates.value.dinner=pickFood('dinner',[candidates.value.lunch!.id]);
  try {
    const memories=await api<Memory[]>('/memories');
    if(token!==generation)return;
    const active=memories.filter(memory=>memory.scope==='life' && ['active','fading'].includes(memory.effective_state));
    for(const meal of meals) {
      const memory=active.find(item=>item.key===choiceKey(day.value,meal.id));
      const selected=memory?readChoices(day.value,meal.id,memory.content):[];
      confirmed.value[meal.id]=selected;
      if(selected.length) {
        const preview=selected.filter(food=>foods.some(item=>item.id===food.id)).pop();
        if(preview)candidates.value[meal.id]=preview;
        playing.value[meal.id]=false;
      }
    }
    ready.value=true;
  } catch(e) {if(token===generation)error.value=(e as Error).message;}
  finally {if(token===generation)loading.value=false;}
}
async function confirm(meal:Meal) {
  const food=candidates.value[meal];
  if(busy.value || !food || inMenu(meal,food))return;
  await saveMenu(meal,[...confirmed.value[meal],food]);
}
async function remove(meal:Meal,food:Food) {
  if(busy.value)return;
  removing.value=meal+':'+food.id;
  await saveMenu(meal,confirmed.value[meal].filter(item=>item.id!==food.id));
}
async function saveMenu(meal:Meal,selected:Food[]) {
  const token=generation;
  saving.value=meal;error.value='';
  try {
    await post('/memories',{key:choiceKey(day.value,meal),content:choiceContent(day.value,meal,selected),scope:'life',kind:'interest',pinned:false});
    if(token===generation){confirmed.value[meal]=selected;playing.value[meal]=false;return true;}
    return false;
  } catch(e) {if(token===generation)error.value=(e as Error).message;return false;}
  finally {if(token===generation){saving.value=null;removing.value='';}}
}
watch(()=>[auth.user?.id,auth.user?.timezone],()=>{day.value=today();},{flush:'sync'});
watch(()=>`${auth.user?.id || ''}:${auth.user?.timezone || ''}:${day.value}`,()=>load(),{immediate:true,flush:'sync'});
onMounted(()=>{clock=window.setInterval(()=>{day.value=today();},60000);});
onUnmounted(()=>{generation++;window.clearInterval(clock);});
</script>

<template>
<section class="feature-page food-page">
  <div class="food-intro"><div><p class="food-kicker">{{day}} · 今日三餐</p><h1><span class="food-desktop-title">把吃饭这件小事，交给一点惊喜</span><span class="food-mobile-title">今日三餐</span></h1><p class="muted">轮播看看早餐、午餐和晚餐，选好了加入今日菜单。</p></div><el-button :icon="Refresh" :disabled="busy" aria-label="重新抽取三餐" @click="drawAll"><span class="food-desktop-title">重新抽取三餐</span><span class="food-mobile-title">换一组</span></el-button></div>
  <el-alert v-if="error" :title="error" type="error" :closable="false"/>
  <p v-if="loading" class="field-hint" role="status">正在读取今日菜单…</p>
  <el-button v-if="!loading && !ready" @click="load">重新读取记忆</el-button>
  <div class="meal-grid">
    <article v-for="meal in meals" :key="meal.id" class="meal-card" :aria-label="meal.name+'选择'">
      <header><h3>{{meal.name}}</h3><span>{{meal.caption}}</span></header>
      <FoodCarousel v-model:playing="playing[meal.id]" :food="candidates[meal.id]" :foods="mealFoods(meal.id)" :meal-name="meal.name" :disabled="savingBusy || previewLoading[meal.id]" @step="(direction,manual)=>step(meal.id,direction,manual)"/>
      <div class="meal-content"><h3>{{candidates[meal.id]?.name}}</h3><p>{{candidates[meal.id]?.note}}</p>
        <div class="meal-actions"><el-button :icon="Refresh" :disabled="busy" @click="draw(meal.id)">换一个</el-button><el-button type="primary" :icon="Check" :loading="saving===meal.id && !removing" :disabled="busy || inMenu(meal.id,candidates[meal.id])" @click="confirm(meal.id)">{{inMenu(meal.id,candidates[meal.id])?'已在菜单':'加入菜单'}}</el-button></div>
      </div>
    </article>
  </div>
  <section class="feature-section food-menu" aria-labelledby="food-menu-title">
    <div class="food-menu-heading"><div><h2 id="food-menu-title">今日菜单</h2><p class="muted">每餐都可以继续添加喜欢的菜，不想吃的随时移除。</p></div><span>共 {{menuCount}} 道</span></div>
    <p v-if="!menuCount" class="field-hint menu-empty">今天的菜单还没选好，先挑一道喜欢的。</p>
    <div class="food-menu-grid">
      <article v-for="meal in meals" :key="meal.id" class="menu-meal" :aria-label="meal.name+'菜单'">
        <header class="menu-meal-heading"><h3>{{meal.name}}</h3><span>{{confirmed[meal.id].length}} 道</span></header>
        <ul v-if="confirmed[meal.id].length" class="menu-dishes">
          <li v-for="food in confirmed[meal.id]" :key="food.id" class="menu-dish">
            <img :src="food.thumbnail" :alt="food.name" width="480" height="480" loading="lazy" decoding="async"/>
            <div><h4>{{food.name}}</h4><p>{{food.note}}</p></div>
            <el-button text :icon="Close" :aria-label="'移除'+meal.name+'中的'+food.name" :disabled="busy" :loading="removing===meal.id+':'+food.id" @click="remove(meal.id,food)">移除</el-button>
          </li>
        </ul>
        <div v-else class="menu-placeholder"><h4>待选择</h4><p>从上方轮播或菜品库挑选</p></div>
      </article>
    </div>
  </section>
  <section class="feature-section food-library"><div class="food-library-header"><div><h2>按分类挑选菜品</h2><p class="muted">先挑喜欢的类别，再直接加入对应的今日菜单。</p></div></div>
    <div class="food-categories" role="group" aria-label="食物类别">
      <el-button v-for="item in categories" :key="item.id" :type="category===item.id?'primary':'default'" :aria-label="item.name" :aria-pressed="category===item.id" @click="category=item.id">{{item.name}}<span class="category-count" aria-hidden="true">{{item.count}}</span></el-button>
    </div>
    <p v-if="libraryNotice" class="field-hint" role="status">{{libraryNotice}}</p>
    <section v-for="group in galleryGroups" :key="group.id" class="food-group" :aria-labelledby="'food-group-'+group.id">
      <div class="food-group-heading"><h3 :id="'food-group-'+group.id">{{group.name}}</h3><span>{{group.foods.length}} 道</span></div>
      <div class="food-gallery"><article v-for="food in group.foods" :key="food.id" :aria-label="food.name"><img :src="food.thumbnail" :alt="food.name" width="480" height="480" loading="lazy" decoding="async"/><div><h4>{{food.name}}</h4><p>{{food.note}}</p><el-button v-if="food.category==='breakfast'" :disabled="busy || inMenu('breakfast',food)" :loading="librarySaving==='breakfast:'+food.id" text @click="select('breakfast',food)">{{inMenu('breakfast',food)?'已选作早餐':'选作早餐'}}</el-button><template v-else><el-button :disabled="busy || inMenu('lunch',food)" :loading="librarySaving==='lunch:'+food.id" text @click="select('lunch',food)">{{inMenu('lunch',food)?'已选作午餐':'选作午餐'}}</el-button><el-button :disabled="busy || inMenu('dinner',food)" :loading="librarySaving==='dinner:'+food.id" text @click="select('dinner',food)">{{inMenu('dinner',food)?'已选作晚餐':'选作晚餐'}}</el-button></template></div></article></div>
    </section>
    <p class="field-hint">食物图片为 AI 生成示意。午餐和晚餐抽取的是菜品，可自行搭配主食。</p>
  </section>
</section>
</template>

<style scoped>
.food-intro,.food-library-header{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:26px}.food-intro h1{font-size:26px;line-height:1.4;margin:8px 0}.food-intro p{margin:0}.food-kicker{color:var(--el-color-primary);font-size:14px;letter-spacing:1px}.meal-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin:24px 0 36px}.meal-card{overflow:hidden;border:1px solid var(--el-border-color-light);border-radius:12px;background:var(--el-bg-color)}.meal-card header{padding:18px 20px}.meal-card header h3{font-size:19px;margin:0 0 4px}.meal-card header span{font-size:13px;color:var(--el-text-color-secondary)}.meal-card img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover}.meal-content{padding:18px 20px}.meal-content h3{font-size:21px;margin:0 0 6px}.meal-content p{font-size:14px;color:var(--el-text-color-secondary);margin:0 0 12px}.meal-actions{display:flex;gap:8px;flex-wrap:wrap}.meal-actions .el-button+.el-button{margin-left:0}.food-categories{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:26px;min-width:0}.food-categories .el-button+.el-button{margin-left:0}.food-library-header h2{margin:0}.food-library-header p{margin:6px 0 0}.food-gallery{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}.food-gallery article{border:1px solid var(--el-border-color-light);border-radius:10px;overflow:hidden;background:var(--el-bg-color)}.food-gallery img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover}.food-gallery article>div{padding:14px}.food-gallery h4{margin:0 0 6px;font-size:17px}.food-gallery p{font-size:12px;color:var(--el-text-color-secondary);margin:0 0 6px;min-height:40px}.food-gallery .el-button{padding:4px 0;min-height:30px;font-size:13px}.food-gallery .el-button+.el-button{margin-left:14px}
@media(max-width:1050px){.meal-grid{gap:14px}.meal-content,.meal-card header{padding:16px 14px}.meal-actions .el-button{padding:10px;font-size:13px}.food-gallery{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:760px){.food-intro,.food-library-header{align-items:flex-start;flex-direction:column;gap:16px}.food-intro h1{font-size:23px}.meal-grid{grid-template-columns:1fr}.meal-card img{aspect-ratio:4/3;max-height:360px}.meal-actions .el-button{font-size:14px;padding:12px 18px}.food-gallery{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.food-gallery article>div{padding:12px}.food-gallery .el-button+.el-button{margin-left:10px}.food-categories{flex-wrap:wrap}.food-intro .el-button{align-self:flex-start}}
.food-menu-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.food-menu-heading h2{margin:0}.food-menu-heading p{margin:6px 0 0}.food-menu-heading>span{font-size:13px;color:var(--el-color-primary);white-space:nowrap;font-variant-numeric:tabular-nums}
.food-menu-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:start;gap:20px}
.menu-meal{min-width:0;border:1px solid var(--el-border-color-light);border-radius:10px;background:var(--el-bg-color);overflow:hidden}
.menu-meal-heading{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--el-border-color-light)}.menu-meal-heading h3{font-size:17px;margin:0}.menu-meal-heading span{font-size:12px;color:var(--el-color-primary);font-variant-numeric:tabular-nums}
.menu-dishes{list-style:none;margin:0;padding:0 14px}.menu-dish{display:flex;align-items:center;gap:10px;padding:14px 0}.menu-dish+.menu-dish{border-top:1px solid var(--el-border-color-light)}
.menu-dish img{width:58px;height:58px;flex-shrink:0;border-radius:7px;object-fit:cover}.menu-dish>div{flex:1;min-width:0}.menu-dish h4{margin:0 0 4px;font-size:15px;line-height:1.4}.menu-dish p{margin:0;font-size:12px;line-height:1.6;color:var(--el-text-color-secondary)}.menu-dish .el-button{flex-shrink:0;padding:7px 4px;font-size:12px;color:var(--el-text-color-secondary)}.menu-dish .el-button:hover{color:var(--el-color-danger)}
.menu-placeholder{padding:24px 16px;color:var(--el-text-color-secondary)}.menu-placeholder h4{font-size:15px;margin:0 0 6px;font-weight:500}.menu-placeholder p{font-size:12px;margin:0;line-height:1.6}.menu-empty{margin-bottom:16px}
@media(max-width:1050px){.food-menu-grid{gap:12px}.menu-dishes{padding:0 10px}.menu-dish{flex-wrap:wrap}.menu-dish img{width:48px;height:48px}.menu-dish .el-button{margin-left:auto}}
@media(max-width:760px){.food-menu-heading{align-items:flex-start}.food-menu-grid{grid-template-columns:1fr}.menu-dishes{padding:0 14px}.menu-dish{flex-wrap:nowrap}.menu-dish img{width:58px;height:58px}}
.food-library-header{margin-bottom:18px}
.category-count{margin-left:8px;font-size:12px;opacity:.72;font-variant-numeric:tabular-nums}
.food-group+.food-group{margin-top:36px}
.food-group-heading{display:flex;align-items:baseline;gap:10px;padding-bottom:12px;margin-bottom:18px;border-bottom:1px solid var(--el-border-color-light)}
.food-group-heading h3{margin:0;font-size:18px;font-weight:600}.food-group-heading>span{font-size:12px;color:var(--el-text-color-secondary);font-variant-numeric:tabular-nums}
.food-mobile-title{display:none}
@media(max-width:760px){
  .food-desktop-title,.food-intro .food-kicker,.food-intro .muted{display:none}
  .food-mobile-title{display:inline}
  .food-intro{flex-direction:row;align-items:center;gap:12px;margin-bottom:14px}
  .food-intro h1{margin:0;font-size:22px}
  .food-intro .el-button{min-height:44px;align-self:center;font-size:13px}
  .meal-grid{gap:10px;margin:0 0 24px}
  .meal-card{display:grid;grid-template-columns:112px minmax(0,1fr);grid-template-rows:auto 1fr;column-gap:12px;padding:10px;border-radius:10px;min-width:0}
  .meal-card header{grid-column:2;grid-row:1;padding:0;margin-bottom:6px}
  .meal-card header h3{margin:0;font-size:13px;line-height:1.4;color:var(--el-text-color-secondary);font-weight:500}
  .meal-card header span{display:none}
  .meal-card .meal-carousel{grid-column:1;grid-row:1 / span 2;align-self:stretch;height:136px;aspect-ratio:auto;border-radius:7px}
  .meal-content{grid-column:2;grid-row:2;display:flex;flex-direction:column;justify-content:space-between;min-width:0;padding:0}
  .meal-content h3{font-size:16px;line-height:1.4;margin:0 0 6px;overflow-wrap:anywhere}
  .meal-content p{display:none}
  .meal-actions{flex-wrap:nowrap;gap:6px}
  .meal-actions .el-button{min-width:0;min-height:44px;padding:8px 7px;font-size:12px}
  .meal-actions .el-button:first-child{flex:1}
  .meal-actions .el-button:last-child{flex:1.4}
  .meal-actions .el-button .el-icon{display:none}
}
@media(max-width:360px){.meal-card{grid-template-columns:96px minmax(0,1fr);column-gap:8px}.meal-actions{gap:4px}.meal-actions .el-button{padding:8px 4px;font-size:11px}}
</style>
