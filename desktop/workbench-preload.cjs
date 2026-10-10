const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('xiaoqiDesktop',{
  retry:()=>ipcRenderer.send('desktop:retry'),
  getSettings:()=>ipcRenderer.invoke('desktop:settings'),
  disconnectAccountSync:()=>ipcRenderer.invoke('desktop:disconnect-account'),
  setSettings:patch=>ipcRenderer.invoke('desktop:update-settings',patch),
  sync:state=>ipcRenderer.send('desktop:state',state),
  onNavigate:callback=>{const listener=(_event,route)=>callback(route);ipcRenderer.on('desktop:navigate',listener);return ()=>ipcRenderer.removeListener('desktop:navigate',listener);},
  onSettings:callback=>{const listener=(_event,settings)=>callback(settings);ipcRenderer.on('desktop:preferences',listener);return ()=>ipcRenderer.removeListener('desktop:preferences',listener);},
});
