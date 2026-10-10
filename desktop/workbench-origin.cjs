'use strict';
const CLOUD_ORIGIN='http://103.236.96.53:60673';
const LOCAL_ORIGIN='http://localhost:5174';
const localHosts=new Set(['localhost','127.0.0.1','[::1]']);
function normalizeWorkbenchOrigin(value){
  try{
    const url=new URL(value);
    if(url.username || url.password || url.pathname!=='/' || url.search || url.hash)return null;
    if(url.protocol==='https:' || url.protocol==='http:' && (localHosts.has(url.hostname) || url.origin===CLOUD_ORIGIN))return url.origin;
  }catch{/* Invalid settings and launch URLs are ignored. */}
  return null;
}
function protocolWorkbenchOrigin(argv,configured=process.env.WORKBENCH_URL){
  try{
    const address=argv.find(value=>value.startsWith('xiaoqi-workbench://'));
    if(!address)return null;
    const url=new URL(address);
    if(!['chat','settings','workbench','pet'].includes(url.hostname) || url.searchParams.getAll('origin').length!==1)return null;
    const origin=normalizeWorkbenchOrigin(url.searchParams.get('origin'));
    if(!origin)return null;
    const host=new URL(origin).hostname;
    // Protocol links may select this deployment, loopback, or an explicitly configured server.
    return origin===CLOUD_ORIGIN || localHosts.has(host) || origin===normalizeWorkbenchOrigin(configured)?origin:null;
  }catch{return null;}
}
function resolveWorkbenchOrigin({argv=[],configured,saved}={}){
  const requested=protocolWorkbenchOrigin(argv,configured || saved);
  if(requested)return requested;
  if(configured){
    const origin=normalizeWorkbenchOrigin(configured);
    if(!origin)throw new Error('工作台地址须为本机 HTTP、已配置的云服务器或 HTTPS 根地址');
    return origin;
  }
  return normalizeWorkbenchOrigin(saved) || LOCAL_ORIGIN;
}
module.exports={CLOUD_ORIGIN,LOCAL_ORIGIN,normalizeWorkbenchOrigin,protocolWorkbenchOrigin,resolveWorkbenchOrigin};
