const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=import('../animation.mjs');
test('walking plays both half strides and follows movement direction',async()=>{
  const {PetAnimation}=await engine,a=new PetAnimation();a.set({kind:'walking',index:1,direction:-1},0);
  for(let t=220;t<1020;t+=25){const f=a.sample(t);assert.equal(f.pose.atlas,'rig');assert.equal(f.pose.elapsed,t-215);assert.equal(f.mix,0);assert.equal(f.direction,-1);assert.equal(f.phase,'walking');}
  a.set({kind:'walking',index:1,direction:-1},400);assert.equal(a.sample(615).pose.elapsed,400);
});
test('switches use real intermediate poses and latest target wins',async()=>{
  const {PetAnimation}=await engine,a=new PetAnimation();a.set({kind:'focus',index:4},0);
  assert.equal(a.sample(50).pose.atlas,'motion');assert.equal(a.sample(150).pose.index,11);
  a.set({kind:'think',index:6},100);a.set({kind:'rest',index:12},150);
  assert.deepEqual(a.sample(400).pose,{atlas:'base',index:12});
  a.set({kind:'idle',index:0},500);assert.equal(a.sample(550).pose.index,10);
});
test('native movement clock and turns preserve continuous leg motion',async()=>{
  const {PetAnimation}=await engine,a=new PetAnimation();a.set({kind:'walking',index:1,direction:1,walkElapsed:400},0);
  assert.equal(a.sample(300).pose.elapsed,400);
  a.set({kind:'walking',index:1,direction:-1,walkElapsed:500},400);
  assert.equal(a.sample(400).pose.elapsed,500);assert.equal(a.sample(400).phase,'walking');assert.equal(a.sample(400).direction,-1);
});
test('dragging interrupts immediately and release lands before standing',async()=>{
  const {PetAnimation}=await engine,a=new PetAnimation();a.set({kind:'celebrate',index:7},0);
  a.set({kind:'dragged',index:8},100);assert.equal(a.target.kind,'dragged');assert.equal(a.sample(100).pose.index,14);
  a.set({kind:'landing',index:9},200);assert.equal(a.sample(200).pose.index,15);assert.equal(a.sample(320).pose.index,10);
});

test('drag direction reaches every animation frame; reversing does not restart the lift',async()=>{
  const {PetAnimation}=await engine,a=new PetAnimation();
  a.set({kind:'dragged',index:8,direction:1},0);
  assert.equal(a.sample(20).direction,1);
  a.set({kind:'dragged',index:8,direction:-1},100);
  assert.equal(a.sample(100).direction,-1);assert.equal(a.sample(100).pose.index,8);
  a.set({kind:'landing',index:9,direction:-1},200);
  assert.equal(a.sample(200).direction,-1);assert.equal(a.sample(450).direction,-1);
  a.set({kind:'remind',index:14,waveHand:'left'},500);
  assert.equal(a.sample(750).waveHand,'left');
});
test('celebration completes a jump before a pending action; motion off is immediate',async()=>{
  const {PetAnimation}=await engine,a=new PetAnimation();a.set({kind:'celebrate',index:7},0);a.set({kind:'focus',index:4},200);
  assert.equal(a.target.kind,'celebrate');assert.equal(a.sample(400).pose.index,7);assert.equal(a.sample(500).pose.index,15);
  a.sample(730);assert.equal(a.target.kind,'focus');assert.equal(a.sample(1000).pose.index,4);
  a.set({kind:'sleep',index:13},1050,false);assert.equal(a.sample(1050).phase,'settled');assert.equal(a.sample(1050).pose.index,13);
});
