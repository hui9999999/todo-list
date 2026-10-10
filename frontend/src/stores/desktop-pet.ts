import {defineStore} from 'pinia';
import {computed,ref,nextTick} from 'vue';
import type {DesktopPetSettings,DesktopPetSnapshot} from '../desktop-types';
import {post} from '../api';
import {nativeApp} from '../platform';
export const useDesktopPet=defineStore('desktop-pet',()=>{
  const available=Boolean(window.xiaoqiDesktop);
  const autoStartKey='todo-v2-desktop-auto-start';
  const autoStart=ref(localPreference(autoStartKey)==='1');
  const supportsAutoStart=Boolean(/Win/i.test(navigator.platform) && !/Android|iPhone|iPad/i.test(navigator.userAgent));
  function localPreference(key:string){try{return localStorage.getItem(key);}catch{return null;}}
  function setAutoStart(value:boolean){autoStart.value=value;try{localStorage.setItem(autoStartKey,value?'1':'0');}catch{/* The current page still respects the selection. */}}
  const settings=ref<DesktopPetSettings|null>(null);
  const styleKey='todo-v2-pet-render-style';
  let savedStyle:string|null=null;try{savedStyle=localStorage.getItem(styleKey);}catch{/* Browser storage is optional. */}
  const previewStyle=ref<'2d'|'3d'>(savedStyle==='2d'?'2d':savedStyle==='3d'?'3d':nativeApp?'2d':'3d'),previewSelected=ref(savedStyle==='2d'||savedStyle==='3d');
  const renderStyle=computed(()=>settings.value?.renderStyle||previewStyle.value);
  const conversationId=ref(''),runId=ref(''),aiStatus=ref<'idle'|'thinking'|'confirm'|'error'>('idle');
  const presenceReady=ref(false),nativeActive=ref(false),launching=ref(false);
  const webEnabled=ref(localPreference('todo-v2-web-pet-visible')!=='0');
  const webAllowed=computed(()=>!available&&presenceReady.value&&!nativeActive.value&&!launching.value&&webEnabled.value);
  const petState=ref<DesktopPetSnapshot>({userId:'',nickname:'',connected:false,aiStatus:'idle',focus:null,break:null,completed:[]});
  const celebrateUntil=ref(0),celebrateTitle=ref('');
  const celebrated=new Set<string>();
  function setWebEnabled(value:boolean){webEnabled.value=value;try{localStorage.setItem('todo-v2-web-pet-visible',value?'1':'0');}catch{/* Session preference remains available. */}}
  function receiveSnapshot(value:DesktopPetSnapshot){
    if(petState.value.userId!==value.userId){celebrated.clear();celebrateUntil.value=0;celebrateTitle.value='';}
    if(value.userId&&value.connected)for(const event of value.completed){
      if(!celebrated.has(event.id)){celebrated.add(event.id);celebrateUntil.value=Date.now()+4200;celebrateTitle.value=event.title;}
    }
    if(celebrated.size>300)celebrated.delete(celebrated.values().next().value!);
    petState.value=value;
  }
  async function load(){if(window.xiaoqiDesktop)settings.value=await window.xiaoqiDesktop.getSettings();}
  async function update(patch:Partial<DesktopPetSettings>){if(window.xiaoqiDesktop)settings.value=await window.xiaoqiDesktop.setSettings(patch);}
  async function chooseStyle(style:'2d'|'3d'){
    if(available)await update({renderStyle:style});
    else {previewStyle.value=style;previewSelected.value=true;try{localStorage.setItem(styleKey,style);}catch{/* The preview still switches for this session. */}}
  }
  function launchUrl(command:'chat'|'settings'|'pet'){
    const url=new URL('xiaoqi-workbench://'+command);
    url.searchParams.set('origin',location.origin);
    if(previewSelected.value)url.searchParams.set('renderStyle',renderStyle.value);
    return url.href;
  }
  async function launch(command:'chat'|'settings'|'pet',isCurrent:()=>boolean=()=>true){
    launching.value=true;
    // Remove the web avatar before asking the OS to show the native one.
    await nextTick();
    let result:{ticket:string};
    try{result=await post<{ticket:string}>('/auth/desktop-link');}catch(error){launching.value=false;throw error;}
    if(!result.ticket){launching.value=false;throw new Error('暂时无法同步账号，请稍后重试。');}
    if(!isCurrent()){launching.value=false;return;}
    window.setTimeout(()=>{launching.value=false;},60000);
    const url=new URL(launchUrl(command));url.searchParams.set('ticket',result.ticket);
    if(command==='pet'){
      const frame=document.createElement('iframe');frame.hidden=true;frame.dataset.desktopLaunch='true';frame.setAttribute('aria-hidden','true');frame.src=url.href;document.body.appendChild(frame);
      window.setTimeout(()=>frame.remove(),60000);
    }else location.assign(url.href);
  }
  function reset(){conversationId.value='';runId.value='';aiStatus.value='idle';celebrated.clear();celebrateUntil.value=0;celebrateTitle.value='';petState.value={userId:'',nickname:'',connected:false,aiStatus:'idle',focus:null,break:null,completed:[]};}
  return {available,autoStart,supportsAutoStart,setAutoStart,settings,renderStyle,chooseStyle,launchUrl,launch,conversationId,runId,aiStatus,load,update,reset,presenceReady,nativeActive,launching,webEnabled,webAllowed,setWebEnabled,petState,receiveSnapshot,celebrateUntil,celebrateTitle};
});
