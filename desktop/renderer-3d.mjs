import * as T from './node_modules/three/build/three.module.js';
import {PetAnimation} from './animation.mjs';
import {createPetModel,VIEW_WIDTH} from './pet-model.mjs';

export function createPetRenderer(canvas){
  const animation=new PetAnimation(),ctx=canvas.getContext('2d'),surface=document.createElement('canvas');
  const renderer=new T.WebGLRenderer({canvas:surface,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
  renderer.setClearColor(0,0);renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.10;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene(),model=createPetModel();scene.add(model.root);
  const camera=new T.OrthographicCamera(-VIEW_WIDTH/2,VIEW_WIDTH/2,VIEW_WIDTH/2,-VIEW_WIDTH/2,.1,30);
  camera.position.set(0,1.38,8);camera.lookAt(0,1.28,0);
  scene.add(new T.HemisphereLight('#fff8eb','#bba489',2.05));
  const key=new T.DirectionalLight('#fff7e9',2.6);key.position.set(-3,5,6);key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=4;key.shadow.camera.bottom=-2;key.shadow.camera.near=.1;key.shadow.camera.far=16;key.shadow.normalBias=.02;
  scene.add(key);const fill=new T.DirectionalLight('#e6f1ff',.85);fill.position.set(3,2,3);scene.add(fill);
  let ready=false,lastSize=0,lastScale=0,previous=0,disposed=false;
  const loaded=renderer.compileAsync(scene,camera).then(()=>{ready=true;});
  function draw(target,now,enabled=true){
    if(disposed)return;
    animation.set(target,now,enabled);const frame=animation.sample(now);
    const size=canvas.getBoundingClientRect().width,scale=Math.min(window.devicePixelRatio||1,2);
    if(size<=0)return;
    const delta=previous?Math.min(.05,Math.max(.001,(now-previous)/1000)):.016;previous=now;
    const info=model.update(frame,size,enabled?now:0,delta);
    canvas.dataset.phase=frame.phase;canvas.dataset.frame=frame.phase==='walking'?(info.phase<.5?'rig:left-stance':'rig:right-stance'):frame.pose.atlas+':'+frame.pose.index;
    canvas.dataset.direction=String(frame.direction);canvas.dataset.waveHand=frame.waveHand||'right';canvas.dataset.yaw=String(model.root.rotation.y);canvas.dataset.handHeight=String(Math.min(...info.hands));canvas.dataset.footHeight=String(Math.min(...info.feet));
    if(!ready)return;
    if(size!==lastSize||scale!==lastScale){canvas.width=Math.round(size*scale);canvas.height=Math.round(size*scale);renderer.setPixelRatio(scale);renderer.setSize(size,size,false);lastSize=size;lastScale=scale;}
    renderer.render(scene,camera);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(surface,0,0,canvas.width,canvas.height);
  }
  function dispose(){disposed=true;model.dispose();key.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();}
  return {draw,loaded,dispose};
}
