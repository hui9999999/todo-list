export interface DesktopPetSettings {
  renderStyle:'2d'|'3d';
  visible:boolean; alwaysOnTop:boolean; motion:boolean; wander:boolean;
  size:120|160|200; position:{x:number;y:number}|null;
}
export interface DesktopPetSnapshot {
  userId:string; nickname:string; connected:boolean;
  aiStatus:'idle'|'thinking'|'confirm'|'error';
  focus:{id:string;state:'running'|'paused';remaining:number;scope:string;title:string}|null;
  break:{state:'running'|'paused';remaining:number}|null;
  completed:{id:string;title:string}[];
}
declare global {
  interface Window {
    xiaoqiPet?:{
      interactive(value:boolean):void;
      drag(phase:'start'|'move'|'end',point?:{x:number;y:number}):void;
    };
    xiaoqiDesktop?:{
      retry():void;
      getSettings():Promise<DesktopPetSettings>;
      disconnectAccountSync?():Promise<void>;
      setSettings(patch:Partial<DesktopPetSettings>):Promise<DesktopPetSettings>;
      sync(state:DesktopPetSnapshot):void;
      onNavigate(callback:(route:string)=>void):()=>void;
      onSettings(callback:(settings:DesktopPetSettings)=>void):()=>void;
    };
  }
}
