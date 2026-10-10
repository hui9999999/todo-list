const test=require('node:test'),assert=require('node:assert/strict');
const {createPetPresence}=require('../pet-presence.cjs');
test('native pet waits for web release and hides when its lease ends, including failed renewals',()=>{
  let time=1000;const changes=[];
  const presence=createPetPresence({managed:true,now:()=>time,onChange:value=>changes.push(value)});
  assert.equal(presence.allowed(),false);
  presence.grant({allowed:false,expiresAt:9000});assert.equal(presence.allowed(),false);
  presence.grant({allowed:true,expiresAt:9000});assert.equal(presence.allowed(),true);
  time=8999;assert.equal(presence.allowed(),true);
  time=9000;assert.equal(presence.allowed(),false);
  assert.deepEqual(changes,[true,false]);
  presence.grant({allowed:true,expiresAt:8999});assert.equal(presence.allowed(),false);
  presence.grant({allowed:true,expiresAt:17000});assert.equal(presence.allowed(),true);
  presence.wait();assert.equal(presence.allowed(),false);
});
test('unlinked standalone desktop works, then participates in web handoff once paired',()=>{
  const presence=createPetPresence();assert.equal(presence.allowed(),true);
  presence.wait();assert.equal(presence.allowed(),false);
});
