const {test}=require('node:test');
const assert=require('node:assert/strict');
test('planted feet cancel desktop movement at every pet size',async()=>{
  const {sampleWalk}=await import('../walk-rig.mjs');
  for(const size of [120,160,200]){
    const cycle=size/100*1000;
    const a=sampleWalk(cycle*.1,size),b=sampleWalk(cycle*.2,size);
    assert.equal(a.left.lift,0);assert.equal(b.left.lift,0);
    assert.ok(Math.abs(b.left.x-a.left.x+25*(cycle*.1/1000))<1e-9);
  }
});
test('opposite feet alternate smoothly across cycle boundaries',async()=>{
  const {sampleWalk}=await import('../walk-rig.mjs');
  const a=sampleWalk(400,160),b=sampleWalk(1200,160);
  assert.equal(a.left.lift,0);assert.ok(a.right.lift>0);
  assert.equal(b.right.lift,0);assert.ok(b.left.lift>0);
  for(const boundary of [800,1600]){
    const before=sampleWalk(boundary-.001,160),after=sampleWalk(boundary+.001,160);
    assert.ok(Math.abs(before.left.x-after.left.x)<.001);
    assert.ok(Math.abs(before.right.x-after.right.x)<.001);
  }
});
