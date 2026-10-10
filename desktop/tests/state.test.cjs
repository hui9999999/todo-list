const {test}=require('node:test');
const assert=require('node:assert/strict');
const {preferences,snapshot,clampPosition,pose}=require('../state.cjs');
test('defaults and damaged persisted settings remain usable',()=>{
  assert.deepEqual(preferences({size:900,motion:'yes',position:{x:NaN,y:1}}),preferences());
  assert.equal(preferences({motion:false,visible:false,size:120}).size,120);
  assert.deepEqual(preferences(null),preferences());
  assert.equal(preferences({renderStyle:'2d'}).renderStyle,'2d');
  assert.equal(preferences({renderStyle:'3d'}).renderStyle,'3d');
  assert.equal(preferences({renderStyle:'invalid'}).renderStyle,'3d');
});
test('clamp supports negative coordinates and a removed monitor',()=>{
  assert.deepEqual(clampPosition({x:-2300,y:1200},{x:-1920,y:0,width:1920,height:1040},208,246),{x:-1920,y:794});
  assert.deepEqual(clampPosition({x:-1500,y:-500},{x:0,y:0,width:1920,height:1040},208,246),{x:0,y:0});
});
test('logout drops task and run information; malformed focus ignored',()=>{
  assert.deepEqual(snapshot({userId:'',aiStatus:'thinking',completed:[{id:'a',title:'old'}],focus:{state:'running',remaining:20}}),snapshot());
  assert.equal(snapshot({userId:'a',focus:{state:'running',remaining:NaN}}).focus,null);
  assert.deepEqual(snapshot(null),snapshot());
  assert.deepEqual(snapshot({userId:'a',completed:[null,{}, {id:'valid',title:'task'}]}).completed,[{id:'valid',title:'task'}]);
});
test('state priority makes pending confirmation distinct from model work',()=>{
  const state=snapshot({userId:'a',connected:true,focus:{id:'f',state:'running',remaining:120,scope:'study'}});
  assert.equal(pose(state).index,4);
  assert.equal(pose({...state,aiStatus:'thinking'}).kind,'think');
  assert.equal(pose({...state,aiStatus:'confirm'}).kind,'remind');
  assert.equal(pose({...state,celebrateUntil:101,celebrateTitle:'task'},100).kind,'celebrate');
  assert.equal(pose({...state,celebrateUntil:99},100).kind,'focus');
});
