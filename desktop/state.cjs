'use strict';
const DEFAULTS = Object.freeze({visible:true, alwaysOnTop:true, motion:true, wander:true, size:160, position:null,renderStyle:'3d'});
const ROUTES = new Set(['/ai','/today','/tasks','/focus','/account']);
const SCOPES = new Set(['work','life','study','unassigned']);
function preferences(value={}) {
  value=value && typeof value==='object'?value:{};
  const result={...DEFAULTS};
  for(const key of ['visible','alwaysOnTop','motion','wander']) if(typeof value[key]==='boolean')result[key]=value[key];
  if([120,160,200].includes(value.size))result.size=value.size;
  if(['2d','3d'].includes(value.renderStyle))result.renderStyle=value.renderStyle;
  if(value.position && Number.isFinite(value.position.x) && Number.isFinite(value.position.y))result.position={x:Math.round(value.position.x),y:Math.round(value.position.y)};
  return result;
}
function text(value,max=120){return typeof value==='string'?value.slice(0,max):'';}
function snapshot(value={}) {
  value=value && typeof value==='object'?value:{};
  const userId=text(value.userId,64),state={userId,nickname:text(value.nickname,40),connected:Boolean(value.connected && userId),aiStatus:'idle',focus:null,break:null,completed:[]};
  if(!userId)return state;
  if(['thinking','confirm','error'].includes(value.aiStatus))state.aiStatus=value.aiStatus;
  if(value.focus && ['running','paused'].includes(value.focus.state) && Number.isFinite(value.focus.remaining)){
    state.focus={id:text(value.focus.id,64),state:value.focus.state,remaining:Math.max(0,Math.min(10800,Math.floor(value.focus.remaining))),scope:SCOPES.has(value.focus.scope)?value.focus.scope:'unassigned',title:text(value.focus.title)};
  }
  if(value.break && ['running','paused'].includes(value.break.state) && Number.isFinite(value.break.remaining))state.break={state:value.break.state,remaining:Math.max(0,Math.min(3600,Math.floor(value.break.remaining)))};
  state.completed=Array.isArray(value.completed)?value.completed.slice(0,5).filter(item=>item && typeof item==='object').map(item=>({id:text(item.id,64),title:text(item.title)})).filter(item=>item.id):[];
  return state;
}
function clampPosition(position,area,width,height){return {x:Math.round(Math.min(Math.max(position.x,area.x),Math.max(area.x,area.x+area.width-width))),y:Math.round(Math.min(Math.max(position.y,area.y),Math.max(area.y,area.y+area.height-height)))};}
function pose(state,now=Date.now()){
  if(state.celebrateUntil>now)return {index:7,kind:'celebrate',label:state.celebrateTitle?'完成：'+state.celebrateTitle:'又完成了一件事'};
  if(state.aiStatus==='thinking')return {index:6,kind:'think',label:'正在思考…'};
  if(state.aiStatus==='confirm')return {index:14,kind:'remind',label:'有任务变更待确认'};
  if(state.focus){if(state.focus.state==='paused')return {index:0,kind:'idle',label:'专注已暂停'};return {index:state.focus.scope==='study'?4:5,kind:'focus',label:'专注 '+clock(state.focus.remaining)};}
  if(state.break)return {index:12,kind:'rest',label:(state.break.state==='paused'?'休息已暂停':'休息 '+clock(state.break.remaining))};
  if(state.aiStatus==='error')return {index:14,kind:'remind',label:'打开聊天查看请求状态'};
  if(state.userId && !state.connected)return {index:0,kind:'idle',label:'暂时无法同步，点我打开工作台'};
  return {index:0,kind:'idle',label:state.userId?'小狒陪着你':'点我登录工作台'};
}
function clock(seconds){return Math.floor(seconds/60).toString().padStart(2,'0')+':'+Math.max(0,seconds%60).toString().padStart(2,'0');}
module.exports={DEFAULTS,ROUTES,preferences,snapshot,clampPosition,pose,clock};
