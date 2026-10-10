/** Keep the selected chat across reloads; text drafts stay in this tab's session. */
const prefix='todo-v2-ai-session:';
export function restoreAssistantSession(userId:string):{conversationId:string;draft:string}{
  if(!userId)return {conversationId:'',draft:''};
  const key=prefix+userId;
  try{
    const raw=sessionStorage.getItem(key);
    if(raw){
      const saved=JSON.parse(raw);
      if(saved && typeof saved.conversationId==='string' && saved.conversationId.length<=100 && typeof saved.draft==='string')
        return {conversationId:saved.conversationId,draft:saved.draft.slice(0,10000)};
    }
  }catch{/* In-memory chat state still works if storage is unavailable. */}
  try{return {conversationId:(localStorage.getItem(key)||'').slice(0,100),draft:''};}
  catch{return {conversationId:'',draft:''};}
}
export function rememberAssistantSession(userId:string,conversationId:string,draft:string){
  if(!userId)return;
  const key=prefix+userId;
  try{sessionStorage.setItem(key,JSON.stringify({conversationId,draft}));}catch{/* The live component retains the draft. */}
  try{if(conversationId)localStorage.setItem(key,conversationId);else localStorage.removeItem(key);}catch{/* Reload recovery is optional when storage is blocked. */}
}
export function forgetAssistantSession(userId:string){
  if(!userId)return;
  try{sessionStorage.removeItem(prefix+userId);}catch{/* Storage may be unavailable. */}
  try{localStorage.removeItem(prefix+userId);}catch{/* Storage may be unavailable. */}
  try{localStorage.removeItem(prefix+'web:'+userId);}catch{/* Storage may be unavailable. */}
}

export function restoreWebSearch(userId:string):boolean{
  try{return !!userId && localStorage.getItem(prefix+'web:'+userId)==='true';}
  catch{return false;}
}
export function rememberWebSearch(userId:string,enabled:boolean){
  if(!userId)return;
  try{localStorage.setItem(prefix+'web:'+userId,String(enabled));}catch{/* The live toggle still works. */}
}
