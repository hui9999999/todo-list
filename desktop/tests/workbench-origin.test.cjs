'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CLOUD_ORIGIN,LOCAL_ORIGIN,normalizeWorkbenchOrigin,protocolWorkbenchOrigin,resolveWorkbenchOrigin}=require('../workbench-origin.cjs');
const {protocolTicket}=require('../account-sync.cjs');
const ticket='a'.repeat(43);
const launch=origin=>'xiaoqi-workbench://pet?origin='+encodeURIComponent(origin)+'&ticket='+ticket;
test('cloud launch selects the issuing server over the local default or saved origin',()=>{
  assert.equal(resolveWorkbenchOrigin({argv:[launch(CLOUD_ORIGIN)],configured:LOCAL_ORIGIN,saved:LOCAL_ORIGIN}),CLOUD_ORIGIN);
  assert.equal(protocolTicket([launch(CLOUD_ORIGIN)]),ticket);
  assert.equal(resolveWorkbenchOrigin({saved:CLOUD_ORIGIN}),CLOUD_ORIGIN);
  assert.equal(resolveWorkbenchOrigin(),LOCAL_ORIGIN);
  assert.equal(resolveWorkbenchOrigin({configured:LOCAL_ORIGIN,saved:CLOUD_ORIGIN}),LOCAL_ORIGIN);
});
test('legacy links keep their configured server and local origins remain supported',()=>{
  assert.equal(protocolTicket(['xiaoqi-workbench://chat?ticket='+ticket]),ticket);
  assert.equal(protocolWorkbenchOrigin([launch(LOCAL_ORIGIN)]),LOCAL_ORIGIN);
  assert.equal(normalizeWorkbenchOrigin('http://127.0.0.1:5174'),'http://127.0.0.1:5174');
  assert.equal(normalizeWorkbenchOrigin('http://[::1]:5174'),'http://[::1]:5174');
});
test('protocol links reject unrelated servers, URL credentials and non-root origins',()=>{
  for(const origin of ['http://untrusted.example','https://untrusted.example','https://user:password@untrusted.example','file:///C:/','http://103.236.96.53:60673/path','http://103.236.96.53:60673/?x=1']){
    assert.equal(protocolWorkbenchOrigin([launch(origin)]),null);
    assert.equal(protocolTicket([launch(origin)]),null);
  }
  assert.equal(protocolWorkbenchOrigin([launch(CLOUD_ORIGIN)+'&origin='+encodeURIComponent(LOCAL_ORIGIN)]),null);
});
test('an explicitly configured HTTPS server can receive its own launch tickets',()=>{
  const origin='https://workbench.example';
  assert.equal(protocolWorkbenchOrigin([launch(origin)],origin),origin);
  assert.equal(protocolTicket([launch(origin)],origin),ticket);
  assert.equal(resolveWorkbenchOrigin({argv:[launch(origin)],saved:origin}),origin);
});
