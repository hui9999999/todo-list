import {nextTick,onUnmounted,watch,ref} from 'vue';
import {api} from './api';
import {createUuid} from './uuid';
import {useAuth} from './stores/auth';
import {useDesktopPet} from './stores/desktop-pet';
import {useRoute} from 'vue-router';

export const pageVisible=ref(document.visibilityState!=='hidden');

export function usePetPresence(){
  const auth=useAuth(),pet=useDesktopPet(),route=useRoute();
  if(pet.available){
    const visibility=()=>{pageVisible.value=document.visibilityState!=='hidden';};
    visibility();document.addEventListener('visibilitychange',visibility);
    onUnmounted(()=>document.removeEventListener('visibilitychange',visibility));
    return;
  }
  const clientId=createUuid();
  let disposed=false,checking=false,generation=0,webLeaseUntil=0;
  function request(hidden:boolean){return api<{desktop_active:boolean}>('/auth/desktop-link/presence',{method:'POST',body:JSON.stringify({client_id:clientId,hidden}),signal:AbortSignal.timeout(2500)});}
  async function poll(){
    if(disposed||checking||!auth.ready||!auth.user)return;
    checking=true;const ticket=generation;let requestedAt=Date.now();
    try{
      const eligible=pageVisible.value&&!pet.launching&&(pet.webEnabled||route.path==='/pet');
      // Register visibility intent before drawing. A native launch must already
      // know to wait, including during the first browser heartbeat.
      const hidden=!eligible||pet.nativeActive;
      let status=await request(hidden);
      if(!status.desktop_active&&eligible&&hidden){requestedAt=Date.now();status=await request(false);}
      if(disposed||ticket!==generation)return;
      const changed=pet.nativeActive!==Boolean(status.desktop_active);
      pet.nativeActive=Boolean(status.desktop_active);pet.presenceReady=true;
      webLeaseUntil=requestedAt+4000;
      if(pet.nativeActive)pet.launching=false;
      if(changed&&pet.nativeActive){
        // Acknowledge only after Vue has removed both the floating pet and preview.
        await nextTick();
        await request(true);
      }
    }catch{/* A failed poll must not grant a new visibility lease. */}
    finally{checking=false;}
  }
  const stop=watch(()=>auth.user?.id,()=>{
    generation++;webLeaseUntil=0;pet.presenceReady=false;pet.nativeActive=false;pet.launching=false;
    void poll();
  },{immediate:true});
  const stopControls=watch(()=>[pet.webEnabled,pet.launching,route.path],()=>{
    generation++;webLeaseUntil=0;pet.presenceReady=false;void nextTick().then(poll);
  },{flush:'sync'});
  function visibility(){generation++;pageVisible.value=document.visibilityState!=='hidden';pet.presenceReady=false;webLeaseUntil=0;void nextTick().then(poll);}
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('todo-app-resume',visibility);
  const timer=setInterval(()=>{
    if(Date.now()>=webLeaseUntil)pet.presenceReady=false;
    void poll();
  },1000);
  onUnmounted(()=>{disposed=true;generation++;stop();stopControls();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('todo-app-resume',visibility);});
}
