'use strict';
const {app,BrowserWindow,ipcMain,Tray,Menu,screen,shell,nativeImage,session,safeStorage,dialog} = require('electron');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {preferences,snapshot,clampPosition,ROUTES}=require('./state.cjs');
const {setPetBounds}=require('./window-geometry.cjs');
const {protocolTicket,protocolAutomatic,createAccountSync}=require('./account-sync.cjs');
const {createAppIcon}=require('./app-icon.cjs');
const {protocolWorkbenchOrigin,resolveWorkbenchOrigin}=require('./workbench-origin.cjs');
const {createPetPresence}=require('./pet-presence.cjs');
const petFile=path.join(__dirname,'pet.html'),petURL=pathToFileURL(petFile).href;
const statusFile=path.join(__dirname,'workbench-status.html'),statusURL=pathToFileURL(statusFile).href;
app.setName('小狒桌宠');
if(process.platform==='win32')app.setAppUserModelId('com.xiaoqi.workbench');
// Keep the existing profile when changing the display name.
app.setPath('userData',process.env.XIAOQI_TEST_DATA?path.resolve(process.env.XIAOQI_TEST_DATA):path.join(app.getPath('appData'),'小栖桌宠'));
const originFile=path.join(app.getPath('userData'),'workbench-origin.json');
let savedOrigin;
try{savedOrigin=JSON.parse(fs.readFileSync(originFile,'utf8')).origin;}catch{/* First launch. */}
const base=new URL(resolveWorkbenchOrigin({argv:process.argv,configured:process.env.WORKBENCH_URL,saved:savedOrigin}));
const appOrigin=base.origin;
let petWindow,workbenchWindow,tray,quitting=false,drag=null,wander=null,receivedInitialState=false;
let movementTimer;
let accountSync;
let pendingTicket=protocolTicket(process.argv,appOrigin);
const accountFile=path.join(app.getPath('userData'),'browser-account-link.bin');
const petPresence=createPetPresence({managed:Boolean(pendingTicket||fs.existsSync(accountFile)),onChange:()=>applyPetVisibility()});
let backgroundLaunch=protocolAutomatic(process.argv);
function protocolRoute(argv){const address=argv.find(value=>value.startsWith('xiaoqi-workbench://'));if(!address)return null;try{return ({settings:'/account',workbench:'/today',chat:'/ai'})[new URL(address).hostname] || '/ai';}catch{return null;}}
let pendingRoute=backgroundLaunch?null:protocolRoute(process.argv);
function protocolStyle(argv){try{const address=argv.find(value=>value.startsWith('xiaoqi-workbench://'));const style=address&&new URL(address).searchParams.get('renderStyle');return ['2d','3d'].includes(style)?{renderStyle:style}:{};}catch{return {};}}
let options=preferences(),state=snapshot(),celebrateUntil=0,celebrateTitle='',lastHeartbeat=0;
const completedVersions=new Map();
function settingsFile(){return path.join(app.getPath('userData'),'pet-preferences.json');}
function save(){try{fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(settingsFile()+'.tmp',JSON.stringify(options));fs.renameSync(settingsFile()+'.tmp',settingsFile());}catch(error){console.warn('桌宠偏好未能保存',error.code);}}
function read(){try{options=preferences(JSON.parse(fs.readFileSync(settingsFile(),'utf8')));}catch{/* First launch or invalid preferences use defaults. */}}
function isApp(event){return workbenchWindow && event.sender===workbenchWindow.webContents && event.senderFrame===event.sender.mainFrame && new URL(event.senderFrame.url).origin===appOrigin;}
function isPet(event){return petWindow && event.sender===petWindow.webContents && event.senderFrame===event.sender.mainFrame && event.senderFrame.url===petURL;}
function packet(){return {options,state:{...state,celebrateUntil,celebrateTitle},walking:Boolean(wander),walkDirection:wander?.direction || 1,walkStartedAt:wander?.startedAt || null};}
function publish(){if(petWindow && !petWindow.isDestroyed())petWindow.webContents.send('pet:state',packet());}
function workArea(position){return screen.getDisplayMatching({x:Math.round(position.x),y:Math.round(position.y),width:1,height:1}).workArea;}
function resize(){
  if(!petWindow)return;
  const area=screen.getPrimaryDisplay().workArea,wanted=options.position || {x:area.x+area.width-options.size-48-26,y:area.y+area.height-options.size-88-20};
  movePet(wanted);
}
function movePet(wanted,area=workArea(wanted)){const place=clampPosition(wanted,area,options.size+48,options.size+88);setPetBounds(petWindow,place,options.size);}
function applyPetVisibility(){if(petWindow&&!petWindow.isDestroyed())options.visible&&petPresence.allowed()?petWindow.showInactive():petWindow.hide();}
function apply(){wander=null;resize();petWindow.setAlwaysOnTop(options.alwaysOnTop,'floating');applyPetVisibility();publish();updateMenu();workbenchWindow.webContents.send('desktop:preferences',options);}
function updateOptions(patch){
  const reappearing=patch.visible===true&&!options.visible&&accountSync?.isLinked();
  if(reappearing)petPresence.wait();
  if(['2d','3d'].includes(patch.renderStyle)&&patch.renderStyle!==options.renderStyle&&petWindow&&!('position' in patch)){
    const {x,y}=petWindow.getBounds();patch={...patch,position:{x,y}};
  }
  options=preferences({...options,...patch});save();apply();if(reappearing)void accountSync.poll();return options;
}
function openWorkbench(route='/ai'){
  if(!ROUTES.has(route))return;
  const chat=route==='/ai';workbenchWindow.setMinimumSize(chat?440:760,580);workbenchWindow.setSize(chat?600:1120,Math.min(820,screen.getPrimaryDisplay().workArea.height-50));
  const bounds=workbenchWindow.getBounds(),anchor=petWindow.getBounds();const place=clampPosition({x:anchor.x-bounds.width+80,y:anchor.y-bounds.height+180},workArea(anchor),bounds.width,bounds.height);workbenchWindow.setPosition(place.x,place.y);
  if(workbenchWindow.webContents.getURL().startsWith(appOrigin)){workbenchWindow.webContents.send('desktop:navigate',route);}else workbenchWindow.loadURL(new URL(route,base).href).catch(()=>{});
  workbenchWindow.show();workbenchWindow.focus();
}
function menuTemplate(){return [
  {label:'和小狒聊天',click:()=>openWorkbench('/ai')},
  {label:'打开个人工作台',click:()=>openWorkbench('/today')},
  {label:'开始专注',click:()=>openWorkbench('/focus')},
  {type:'separator'},
  {label:'显示小狒',type:'checkbox',checked:options.visible,click:item=>updateOptions({visible:item.checked})},
  {label:'始终置顶',type:'checkbox',checked:options.alwaysOnTop,click:item=>updateOptions({alwaysOnTop:item.checked})},
  {label:'动作动画',type:'checkbox',checked:options.motion,click:item=>updateOptions({motion:item.checked})},
  {label:'闲时漫步',type:'checkbox',checked:options.wander,click:item=>updateOptions({wander:item.checked})},
  {label:'版本',submenu:[{label:'2D 原版',type:'radio',checked:options.renderStyle==='2d',click:()=>updateOptions({renderStyle:'2d'})},{label:'3D 立体',type:'radio',checked:options.renderStyle==='3d',click:()=>updateOptions({renderStyle:'3d'})}]},
  {label:'大小',submenu:[120,160,200].map(size=>({label:({120:'小',160:'标准',200:'大'})[size],type:'radio',checked:options.size===size,click:()=>updateOptions({size})}))},
  {label:'重置位置',click:()=>{options.position=null;save();apply();}},
  {label:'桌宠设置',click:()=>openWorkbench('/account')},
  {type:'separator'},
  {label:'退出小狒',click:()=>{quitting=true;app.quit();}},
];}
function updateMenu(){if(tray)tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));}
function external(url){try{const parsed=new URL(url);if(parsed.protocol==='https:' || parsed.protocol==='http:')void shell.openExternal(parsed.href);}catch{/* Ignore invalid URLs. */}}
function restrict(win,allowed){win.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});win.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});win.webContents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});}
function receive(data){
  const next=snapshot(data);lastHeartbeat=Date.now();
  if(!receivedInitialState){receivedInitialState=true;if(!next.userId && !backgroundLaunch)workbenchWindow.show();}
  if(next.userId!==state.userId){celebrateUntil=0;celebrateTitle='';completedVersions.clear();}
  if(next.connected){for(const task of next.completed){const key=next.userId+':'+task.id;if(!completedVersions.has(key)){completedVersions.set(key,Date.now());celebrateUntil=Date.now()+4200;celebrateTitle=task.title;}}}
  while(completedVersions.size>300)completedVersions.delete(completedVersions.keys().next().value);
  state=next;if(state.focus||state.break||state.aiStatus!=='idle'||celebrateUntil>Date.now())wander=null;publish();
  if(next.userId && pendingRoute){const route=pendingRoute;pendingRoute=null;openWorkbench(route);}
}
function setupIPC(){
  ipcMain.on('desktop:retry',event=>{
    if(workbenchWindow && event.sender===workbenchWindow.webContents && event.senderFrame===event.sender.mainFrame && event.senderFrame.url===statusURL){
      workbenchWindow.loadURL(new URL(pendingRoute || '/ai',base).href).catch(()=>{});
    }
  });
  ipcMain.handle('desktop:settings',event=>{if(!isApp(event))throw new Error('来源无效');return options;});
  ipcMain.handle('desktop:disconnect-account',async event=>{if(!isApp(event))throw new Error('来源无效');await accountSync?.disconnect();});
  ipcMain.handle('desktop:update-settings',(event,patch)=>{if(!isApp(event))throw new Error('来源无效');const safe={};for(const key of ['visible','alwaysOnTop','motion','wander','size','renderStyle'])if(key in (patch || {}))safe[key]=patch[key];if(patch?.position===null)safe.position=null;return updateOptions(safe);});
  ipcMain.on('desktop:state',(event,value)=>{if(isApp(event))receive(value);});
  ipcMain.handle('pet:snapshot',event=>{if(!isPet(event))throw new Error('来源无效');return packet();});
  ipcMain.on('pet:command',(event,command)=>{if(!isPet(event))return;if(command==='chat')openWorkbench('/ai');if(command==='menu')Menu.buildFromTemplate(menuTemplate()).popup({window:petWindow});});
  ipcMain.on('pet:interactive',(event,interactive)=>{if(isPet(event) && !drag)petWindow.setIgnoreMouseEvents(!Boolean(interactive),{forward:true});});
  ipcMain.on('pet:drag',(event,phase,point)=>{
    if(!isPet(event))return;
    if(point!==undefined && (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)))return;
    // Preserve the coordinates when input occurred, even if IPC runs after release.
    const current=point || screen.getCursorScreenPoint();
    if(phase==='start'){wander=null;drag={cursor:current,bounds:petWindow.getBounds()};petWindow.setIgnoreMouseEvents(false);}
    if(drag && (phase==='move' || (phase==='end' && point))){const wanted={x:drag.bounds.x+current.x-drag.cursor.x,y:drag.bounds.y+current.y-drag.cursor.y};movePet(wanted,screen.getDisplayNearestPoint(current).workArea);}
    if(phase==='end' && drag){const bounds=petWindow.getBounds();options.position={x:bounds.x,y:bounds.y};drag=null;save();publish();}
  });
}
function start(){
  read();
  try{fs.mkdirSync(path.dirname(originFile),{recursive:true});fs.writeFileSync(originFile+'.tmp',JSON.stringify({origin:appOrigin}));fs.renameSync(originFile+'.tmp',originFile);}catch(error){console.warn('工作台地址未能保存',error.code);}
  const appIcon=createAppIcon(nativeImage);
  options=preferences({...options,...(backgroundLaunch?{visible:true}:{}),...protocolStyle(process.argv)});
  petWindow=new BrowserWindow({width:options.size+48,height:options.size+86,transparent:true,frame:false,resizable:false,hasShadow:false,skipTaskbar:true,focusable:false,alwaysOnTop:options.alwaysOnTop,show:false,title:'小狒桌宠',icon:appIcon,webPreferences:{preload:path.join(__dirname,'pet-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  workbenchWindow=new BrowserWindow({width:600,height:780,minWidth:440,minHeight:580,show:false,title:'小狒 · 个人工作台',icon:appIcon,backgroundColor:'#faf7f0',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'workbench-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'persist:xiaoqi-workbench',backgroundThrottling:false}});
  const webSession=workbenchWindow.webContents.session;
  webSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===workbenchWindow.webContents && new URL(contents.getURL()).origin===appOrigin && permission==='notifications'));
  webSession.setPermissionCheckHandler((contents,permission,origin)=>contents===workbenchWindow.webContents && origin===appOrigin && permission==='notifications');
  restrict(workbenchWindow,url=>{try{return url===statusURL || new URL(url).origin===appOrigin;}catch{return false;}});restrict(petWindow,url=>url===petURL);
  workbenchWindow.on('close',event=>{if(!quitting){event.preventDefault();workbenchWindow.hide();}});
  workbenchWindow.webContents.on('did-fail-load',(_event,code,_description,url,isMain)=>{
    if(isMain && code!==-3){
      state={...snapshot(),connected:false};publish();
      if(url!==statusURL)void workbenchWindow.loadFile(statusFile).catch(()=>{});
      workbenchWindow.show();
    }
  });
  setupIPC();
  petWindow.loadFile(petFile);petWindow.once('ready-to-show',apply);
  workbenchWindow.loadURL(new URL('/ai',base).href).catch(()=>{});
  accountSync=createAccountSync({base,webSession,file:accountFile,
    getPetVisible:()=>options.visible&&!quitting,
    onPresence:value=>petPresence.grant(value),onPairing:()=>petPresence.wait(),
    encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error('系统凭据存储不可用');return safeStorage.encryptString(value);},
    decrypt:value=>safeStorage.decryptString(value),
    confirm:async user=>{
      const result=await dialog.showMessageBox(workbenchWindow,{type:'question',title:'同步网页账号',message:'将小狒同步到 '+(user.nickname || user.identifier)+'？',detail:'绑定后，此浏览器切换账号或退出登录时，小狒也会自动跟随。',buttons:['同步账号','取消'],defaultId:0,cancelId:1});
      return result.response===0;
    },
    onChanged:async user=>{
      state=snapshot();celebrateUntil=0;celebrateTitle='';completedVersions.clear();wander=null;publish();
      const requestedRoute=pendingRoute;pendingRoute=null;
      let route=requestedRoute || '/ai';
      try{const current=new URL(workbenchWindow.webContents.getURL());if(!requestedRoute && current.origin===appOrigin && ROUTES.has(current.pathname))route=current.pathname+current.search;}catch{/* Use chat after a disconnected page. */}
      await workbenchWindow.loadURL(new URL(user?route:'/auth',base).href).catch(()=>{});
    },
    onError:message=>{if(!quitting)void dialog.showMessageBox(workbenchWindow,{type:'info',title:'网页账号同步',message});},
  });
  const initialTicket=pendingTicket;pendingTicket=null;
  if(initialTicket)void accountSync.pair(initialTicket);else void accountSync.poll();
  if(!process.env.XIAOQI_TEST_DATA){
    const icon=appIcon.resize({width:32,height:32,quality:'best'});
    tray=new Tray(icon);tray.setToolTip('小狒 · 个人工作台');tray.on('click',()=>openWorkbench('/ai'));updateMenu();
  }
  screen.on('display-removed',resize);screen.on('display-metrics-changed',resize);
  let walkTick=0;
  movementTimer=setInterval(()=>{
    if(!petPresence.allowed())wander=null;
    if(lastHeartbeat && Date.now()-lastHeartbeat>15000 && state.connected){state={...state,connected:false,focus:null,break:null,aiStatus:'idle'};wander=null;publish();}
    if(wander){if(drag || !options.visible || !options.motion || !options.wander || state.focus || state.break || state.aiStatus!=='idle'||celebrateUntil>Date.now()){wander=null;publish();return;}if(Date.now()<wander.startedAt)return;const bounds=petWindow.getBounds(),area=workArea(bounds);let wanted={x:bounds.x+wander.direction,y:bounds.y};if(clampPosition(wanted,area,options.size+48,options.size+88).x===bounds.x){wander.direction*=-1;publish();wanted.x=bounds.x+wander.direction;}movePet(wanted,area);if(--wander.steps<=0){wander=null;publish();}}
    else if(++walkTick%800===0 && options.visible && options.motion && options.wander && !drag && !state.focus && !state.break && state.aiStatus==='idle' && celebrateUntil<Date.now()){wander={direction:Math.random()>.5?1:-1,steps:55,startedAt:Date.now()+215};publish();}
  },40);
}
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',(_event,argv)=>{
    const requestedOrigin=protocolWorkbenchOrigin(argv,appOrigin);
    if(requestedOrigin && requestedOrigin!==appOrigin){
      // Restart before handling the ticket so cookies, navigation and sync share one origin.
      app.relaunch({args:[path.resolve(__dirname),argv.find(value=>value.startsWith('xiaoqi-workbench://'))]});
      quitting=true;app.quit();return;
    }
    updateOptions({visible:true,...protocolStyle(argv)});if(!protocolAutomatic(argv)){backgroundLaunch=false;const route=protocolRoute(argv) || '/ai';if(state.userId)openWorkbench(route);else{pendingRoute=route;openWorkbench('/ai');}}const ticket=protocolTicket(argv,appOrigin);if(ticket){if(accountSync)void accountSync.pair(ticket);else pendingTicket=ticket;}
  });
  app.whenReady().then(()=>{if(!process.env.XIAOQI_TEST_DATA){app.setAsDefaultProtocolClient('xiaoqi-workbench',process.execPath,[path.resolve(__dirname)]);}start();});
  app.on('window-all-closed',()=>{});app.on('before-quit',()=>{
    quitting=true;clearInterval(movementTimer);
    accountSync?.stop();
    if(tray){tray.destroy();tray=null;}
    save();
  });
}
