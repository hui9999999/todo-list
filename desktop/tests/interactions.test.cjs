const {test}=require('node:test');
const assert=require('node:assert/strict');
const interactions=import('../interactions.mjs');

test('hover debounces brief visits, varies reactions without repeats and pauses between actions',async()=>{
  const {HoverReactions}=await interactions,reactions=new HoverReactions(()=>0);
  reactions.enter(0);assert.equal(reactions.sample(100),null);
  reactions.leave();assert.equal(reactions.sample(500),null);
  reactions.enter(1000);
  const first=reactions.sample(1200);assert.equal(first.id,'wave-right');
  assert.equal(reactions.sample(1400).id,first.id);
  assert.equal(reactions.sample(1200+first.duration+1),null);
  const next=reactions.sample(1200+first.duration+4800);assert.notEqual(next.kind,first.kind);
  reactions.leave();assert.equal(reactions.sample(1200+first.duration+4800+next.duration+1),null);
});

test('both waving hands are selectable and rapid re-entry observes the cooldown',async()=>{
  const {HoverReactions}=await interactions;
  for(const [random,id,hand] of [[0,'wave-right','right'],[.21,'wave-left','left']]){
    const reactions=new HoverReactions(()=>random);reactions.enter(0);
    const first=reactions.sample(200);assert.equal(first.id,id);assert.equal(first.waveHand,hand);
    reactions.leave();reactions.enter(300);assert.equal(reactions.sample(400).id,id);
    assert.equal(reactions.sample(200+first.duration+1),null);
    assert.equal(reactions.sample(200+first.duration+2100),null);
  }
});

test('focus, break, AI, celebration, walking, pointer press and quiet mode suppress hover immediately',async()=>{
  const {HoverReactions,canHoverReact}=await interactions;
  const base={options:{motion:true},state:{aiStatus:'idle'}};
  assert.equal(canHoverReact(base,{now:1000}),true);
  for(const packet of [
    {...base,walking:true},{...base,options:{motion:false}},
    {...base,state:{focus:{state:'paused'}}},{...base,state:{break:{state:'running'}}},
    ...['thinking','confirm','error'].map(aiStatus=>({...base,state:{aiStatus}})),
    {...base,state:{celebrateUntil:2000}},
  ])assert.equal(canHoverReact(packet,{now:1000}),false);
  for(const context of [{dragging:true},{pressed:true},{reduced:true}])assert.equal(canHoverReact(base,{now:1000,...context}),false);
  const reactions=new HoverReactions(()=>0);reactions.enter(0);assert(reactions.sample(200));
  assert.equal(reactions.sample(300,false),null);assert.equal(reactions.sample(10000),null);
});

test('drag faces the latest horizontal motion, retaining direction during vertical movement and jitter',async()=>{
  const {DragFacing}=await interactions,facing=new DragFacing();
  facing.start(200);assert.equal(facing.move(220),1);
  assert.equal(facing.move(210),-1);assert.equal(facing.move(210),-1);
  assert.equal(facing.move(211),-1);assert.equal(facing.move(212),-1);
  assert.equal(facing.move(214),1);
});
