'use strict';
const fs=require('node:fs'),path=require('node:path');
const {protocolWorkbenchOrigin}=require('./workbench-origin.cjs');

function protocolTicket(argv,configured=process.env.WORKBENCH_URL){
  try{
    const address=argv.find(value=>value.startsWith('xiaoqi-workbench://'));
    if(!address)return null;
    const url=new URL(address),ticket=url.searchParams.get('ticket');
    if(url.searchParams.has('origin') && !protocolWorkbenchOrigin(argv,configured))return null;
    return ['chat','settings','workbench','pet'].includes(url.hostname) && /^[A-Za-z0-9_-]{43}$/.test(ticket || '')?ticket:null;
  }catch{return null;}
}

function protocolAutomatic(argv){
  try{const address=argv.find(value=>value.startsWith('xiaoqi-workbench://'));return Boolean(address && new URL(address).hostname==='pet');}catch{return false;}
}

function createAccountSync({base,webSession,file,encrypt,decrypt,confirm,onChanged,onError,getPetVisible,onPresence=()=>{},onPairing=()=>{}}){
  let token=null,revision=null,checking=false,pairing=false,disposed=false,timer;
  try{
    const saved=JSON.parse(decrypt(fs.readFileSync(file)));
    if(saved.origin===base.origin && /^[A-Za-z0-9_-]{43}$/.test(saved.token || ''))token=saved.token;
  }catch{/* No link on first launch, or a different Windows profile. */}
  async function request(route,body){
    const response=await webSession.fetch(new URL('/api/v1/auth/desktop-link/'+route,base).href,{
      method:'POST',credentials:'include',headers:{'Content-Type':'application/json','Origin':base.origin},
      body:JSON.stringify(body),signal:AbortSignal.timeout(5000),
    });
    if(!response.ok){const error=new Error('账号同步暂时不可用');error.status=response.status;throw error;}
    return response.json();
  }
  function forget(){token=null;revision=null;try{fs.unlinkSync(file);}catch{/* May not exist. */}}
  async function poll(){
    if(!token || checking || pairing || disposed)return;
    checking=true;
    const requestedAt=Date.now();
    try{
      const result=await request('session',{token,revision,...(getPetVisible?{pet_visible:getPetVisible()}: {})});
      if(disposed)return;
      if(typeof result.pet_allowed==='boolean')onPresence({allowed:result.pet_allowed,expiresAt:requestedAt+Math.min(8000,Math.max(0,result.pet_lease_ms||0))});
      revision=result.revision;
      if(result.changed)await onChanged(result.user);
    }catch(error){
      if(error.status===410){forget();onPresence({allowed:false,expiresAt:0});onError('网页账号同步已过期，请从网页重新打开桌宠。');}
      // Connection failures preserve the link for retry, without changing the current account.
    }finally{checking=false;}
  }
  async function pair(ticket){
    if(!ticket || disposed || pairing)return;
    onPairing();
    pairing=true;
    try{
      // Serialize with any in-flight cookie update before installing another link.
      while(checking && !disposed)await new Promise(resolve=>setTimeout(resolve,25));
      if(disposed)return;
      const preview=await request('preview',{token:ticket,desktop_token:token});
      if(!preview.trusted && !await confirm(preview.user))return;
      const result=await request('claim',{token:ticket,desktop_token:token});
      const data=encrypt(JSON.stringify({origin:base.origin,token:result.token}));
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file+'.tmp',data);fs.renameSync(file+'.tmp',file);
      if(result.token!==token)revision=null;
      token=result.token;
    }catch(error){onError(error.status===410?'账号同步链接已失效，请从网页重新打开桌宠。':'账号同步暂时失败，请稍后从网页重试。');}
    finally{pairing=false;await poll();}
  }
  async function disconnect(){
    pairing=true;
    onPresence({allowed:false,expiresAt:0});
    try{
      while(checking && !disposed)await new Promise(resolve=>setTimeout(resolve,25));
      const previous=token;forget();
      if(previous)await request('disconnect',{token:previous});
    }finally{pairing=false;}
  }
  timer=setInterval(()=>void poll(),2000);
  return {pair,poll,disconnect,isLinked:()=>Boolean(token),stop(){disposed=true;clearInterval(timer);}};
}

module.exports={protocolTicket,protocolAutomatic,createAccountSync};
