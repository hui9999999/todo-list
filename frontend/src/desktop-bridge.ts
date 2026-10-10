import {onMounted,onUnmounted,watch} from 'vue';
import {useRouter} from 'vue-router';
import {api,ApiError} from './api';
import {useAuth} from './stores/auth';
import {useTasks} from './stores/tasks';
import {useDesktopPet} from './stores/desktop-pet';
import type {DesktopPetSnapshot} from './desktop-types';
import type {Task} from './types';
import type {Focus,Run} from './advanced-types';

export function useDesktopBridge(){
  const bridge=window.xiaoqiDesktop;
  const auth=useAuth(),tasks=useTasks(),desktop=useDesktopPet(),router=useRouter();
  let rows:Focus[]=[],sampledAt=Date.now(),connected=false,checking=false,disposed=false,generation=0;
  let completed=new Map<string,string>(),baseline=false,pending:{id:string;title:string}[]=[];
  let timer:ReturnType<typeof setInterval>|undefined,unsubscribeNavigate:(()=>void)|undefined,unsubscribeSettings:(()=>void)|undefined,ticks=0;
  function detect(values:Task[]){
    if(!connected || !auth.user)return;
    if(baseline)for(const task of values)if(task.status==='done' && completed.has(task.id) && completed.get(task.id)!=='done')pending.push({id:task.id+':'+task.version,title:task.title});
    completed=new Map(values.map(task=>[task.id,task.status]));baseline=true;
  }
  function readBreak():DesktopPetSnapshot['break']{
    if(!auth.user)return null;
    try{const saved=JSON.parse(localStorage.getItem('todo-v2-pomodoro:'+auth.user.id)||'null');
      if(!saved || !['short','long'].includes(saved.mode) || !['running','paused'].includes(saved.state))return null;
      const seconds=saved.state==='running' && Number.isFinite(saved.endsAt)?Math.ceil((saved.endsAt-Date.now())/1000):saved.remaining;
      return Number.isFinite(seconds)&&seconds>0?{state:saved.state,remaining:Math.min(3600,seconds)}:null;
    }catch{return null;}
  }
  function publish(){
    if(!auth.ready || disposed)return;
    const active=connected?(rows.find(row=>row.state==='running')||rows.find(row=>row.state==='paused')):null;
    const task=active?tasks.items.find(task=>task.id===active.task_id):null;
    const remaining=active?Math.max(0,Math.ceil(active.duration_seconds-active.elapsed-(active.state==='running'?(Date.now()-sampledAt)/1000:0))):0;
    const value:DesktopPetSnapshot={userId:auth.user?.id||'',nickname:auth.displayName,connected:connected && Boolean(auth.user),aiStatus:connected?desktop.aiStatus:'idle',
      focus:active?{id:active.id,state:active.state as 'running'|'paused',remaining,scope:task?.scope||'unassigned',title:task?.title||''}:null,
      break:connected&&!active?readBreak():null,completed:connected?pending.splice(0,5):[]};
    if(bridge)bridge.sync(value);else desktop.receiveSnapshot(value);
  }
  async function poll(){
    if(checking || !auth.user || disposed)return;
    const ticket=generation,userId=auth.user.id;checking=true;
    try{
      const [taskResult,focusResult]=await Promise.all([api<Task[]>('/tasks'),api<Focus[]>('/focus-sessions')]);
      if(disposed || ticket!==generation || auth.user?.id!==userId)return;
      connected=true;
      for(const previous of rows)if(['running','paused'].includes(previous.state) && focusResult.some(row=>row.id===previous.id && row.state==='completed'))pending.push({id:'focus:'+previous.id,title:'一轮专注'});
      rows=focusResult;sampledAt=Date.now();detect(taskResult);tasks.items=taskResult;
      if(desktop.runId && desktop.aiStatus==='thinking'){
        try{const run=await api<Run>('/agent-runs/'+desktop.runId);if(ticket!==generation)return;desktop.aiStatus=['pending','running'].includes(run.status)?'thinking':['awaiting_confirmation','awaiting_clarification'].includes(run.status)?'confirm':run.status==='failed'?'error':'idle';}catch{/* The active chat also recovers run state. */}
      }
    }catch(error){if(ticket!==generation)return;connected=false;rows=[];
      if(error instanceof ApiError && error.status===401){await auth.restore().catch(()=>{});if(!auth.user)await router.replace('/auth');}
    }finally{checking=false;publish();}
  }
  watch(()=>auth.user?.id,()=>{generation++;connected=false;rows=[];pending=[];completed.clear();baseline=false;desktop.reset();publish();void poll();});
  watch(()=>tasks.items.map(task=>task.id+':'+task.version+':'+task.status).join('|'),()=>{detect(tasks.items);publish();});
  watch(()=>desktop.aiStatus,publish);
  onMounted(()=>{
    void desktop.load();unsubscribeNavigate=bridge?.onNavigate(route=>{if(['/ai','/today','/tasks','/focus','/account'].includes(route))void router.push(route);});
    unsubscribeSettings=bridge?.onSettings(settings=>{desktop.settings=settings;});
    void poll();publish();timer=setInterval(()=>{publish();if(++ticks%4===0)void poll();},1000);
  });
  onUnmounted(()=>{disposed=true;generation++;clearInterval(timer);unsubscribeNavigate?.();unsubscribeSettings?.();});
}
