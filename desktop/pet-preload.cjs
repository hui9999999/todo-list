const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('xiaoqiPet',{
  snapshot:()=>ipcRenderer.invoke('pet:snapshot'),
  command:command=>{if(['chat','menu'].includes(command))ipcRenderer.send('pet:command',command);},
  drag:(phase,point)=>{if(['start','move','end'].includes(phase))ipcRenderer.send('pet:drag',phase,point);},
  interactive:value=>ipcRenderer.send('pet:interactive',Boolean(value)),
  onState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('pet:state',listener);return ()=>ipcRenderer.removeListener('pet:state',listener);},
});
