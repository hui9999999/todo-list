const {test}=require('node:test');
const assert=require('node:assert/strict');
const modules=Promise.all([import('../pet-model.mjs'),import('../node_modules/three/build/three.module.js')]);
const frame=(pose,direction=1)=>({pose,next:pose,mix:0,y:0,rotation:0,direction,phase:pose.atlas==='rig'?'walking':'settled'});
test('全尺寸完整步态：手不落地，双脚交替支撑，四肢关节长度保持不变',async()=>{
  const [{createPetModel},T]=await modules;
  for(const size of [120,160,200]){
    const model=createPetModel(),period=size/100*1000;
    let leftLift=false,rightLift=false;
    for(let elapsed=0;elapsed<period*2;elapsed+=16){
      const info=model.update(frame({atlas:'rig',index:0,elapsed}),size,elapsed,.016);
      assert(Math.min(...info.hands)>.75,'手必须始终在腰部附近');
      assert(Math.abs(Math.min(...info.feet)-.205)<1e-6,'至少一只脚踩稳地面');
      leftLift ||=info.feet[0]>.23;rightLift ||=info.feet[1]>.23;
      for(const limb of [...model.legs,...model.arms]){
        const hip=limb.hip.getWorldPosition(new T.Vector3()),knee=limb.knee.getWorldPosition(new T.Vector3()),ankle=limb.ankle.getWorldPosition(new T.Vector3());
        assert(Math.abs(hip.distanceTo(knee)-Math.abs(limb.knee.position.y))<1e-6);
        assert(Math.abs(knee.distanceTo(ankle)-Math.abs(limb.ankle.position.y))<1e-6);
        assert(limb.skin.isSkinnedMesh&&limb.skin.skeleton.bones.length===3);
      }
    }
    assert(leftLift&&rightLift);model.dispose();
  }
});
test('所有日常动作与中间态中，手保持在脚上方且关节无跳变',async()=>{
  const [{createPetModel},T]=await modules,model=createPetModel();let previous=null;
  for(const pose of [...Array.from({length:16},(_,index)=>({atlas:'base',index})),...Array.from({length:8},(_,i)=>({atlas:'motion',index:i+8}))]){
    for(let i=0;i<40;i++){
      const info=model.update(frame(pose),160,i*16,.016);
      assert(Math.min(...info.hands)>Math.max(...info.feet)+.4);
      const positions=model.arms.map(arm=>arm.ankle.getWorldPosition(new T.Vector3()));
      if(previous)for(let j=0;j<2;j++)assert(positions[j].distanceTo(previous[j])<.15,'手臂切换必须连续');
      previous=positions;
    }
  }
  model.dispose();
});
test('转身使用连续旋转，最终朝向与行走方向一致',async()=>{
  const [{createPetModel,WALK_YAW}]=await modules,model=createPetModel();
  for(let i=0;i<100;i++)model.update(frame({atlas:'rig',index:0,elapsed:i*16}),160,i*16,.016);
  assert(Math.abs(model.root.rotation.y-WALK_YAW)<.001);
  let previous=model.root.rotation.y;
  for(let i=0;i<100;i++){
    model.update(frame({atlas:'rig',index:0,elapsed:i*16},-1),160,i*16,.016);
    assert(Math.abs(model.root.rotation.y-previous)<.26);previous=model.root.rotation.y;
  }
  assert(Math.abs(model.root.rotation.y+WALK_YAW)<.001);model.dispose();
});

test('左右招手分别抬起对应手臂，拖动平滑朝移动方向转脸',async()=>{
  const [{createPetModel,WALK_YAW}]=await modules,model=createPetModel();
  for(const [waveHand,raised] of [['left',0],['right',1]]){
    let info;
    for(let i=0;i<80;i++)info=model.update({...frame({atlas:'base',index:14}),kind:'remind',waveHand},160,i*16,.016);
    assert(info.hands[raised]>info.hands[1-raised]+.3);
  }
  for(const direction of [1,-1]){
    let previous=model.root.rotation.y;
    for(let i=0;i<80;i++){
      model.update({...frame({atlas:'base',index:8},direction),kind:'dragged'},160,i*16,.016);
      assert(Math.abs(model.root.rotation.y-previous)<.26);previous=model.root.rotation.y;
    }
    assert(Math.abs(model.root.rotation.y-direction*WALK_YAW)<.001);
  }
  model.dispose();
});
