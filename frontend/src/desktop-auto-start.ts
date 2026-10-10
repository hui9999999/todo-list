import {onUnmounted,watch} from 'vue';
import {useAuth} from './stores/auth';
import {useDesktopPet} from './stores/desktop-pet';

export function useDesktopAutoStart(){
  const auth=useAuth(),desktop=useDesktopPet();
  // Automated browser runs must not launch the operator's installed desktop app.
  if(desktop.available || !desktop.supportsAutoStart || navigator.webdriver)return;
  let attemptedFor:string|null=null,generation=0;
  const stop=watch(()=>[auth.ready,auth.user?.id,desktop.autoStart,desktop.presenceReady] as const,([ready,userId,enabled,presenceReady])=>{
    if(!ready || !userId || !enabled){attemptedFor=null;generation++;return;}
    if(!presenceReady)return;
    if(attemptedFor===userId)return;
    attemptedFor=userId;
    const ticket=++generation;
    void desktop.launch('pet',()=>ticket===generation && auth.user?.id===userId && desktop.autoStart).catch(()=>{
      // Startup is optional; the desktop page retains its explicit launch action.
    });
  },{immediate:true});
  onUnmounted(()=>{generation++;stop();});
}
