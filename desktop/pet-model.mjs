import * as T from './node_modules/three/build/three.module.js';
import {sampleWalk} from './walk-rig.mjs';

export const VIEW_WIDTH=3.2,WALK_YAW=.75;
const down=new T.Vector3(0,-1,0),v=(x,y,z)=>new T.Vector3(x,y,z);
const mix=(a,b,t)=>a+(b-a)*t;
function material(color){return new T.MeshStandardMaterial({color,roughness:.93,metalness:0});}
const colors={cream:'#f2d5b5',pink:'#e7a38c',sage:'#8c9b79',cocoa:'#533729',paper:'#fff3d6'};
export function createPetModel(){
  const root=new T.Group(),body=new T.Group(),head=new T.Group();root.add(body);head.position.set(0,1.70,.02);body.add(head);
  const mats=Object.fromEntries(Object.entries(colors).map(([key,color])=>[key,material(color)]));
  mats.cocoa.roughness=.45;
  const geometries=new Set(),materials=new Set(Object.values(mats));
  function mesh(parent,geometry,mat,position,scale){
    geometries.add(geometry);const part=new T.Mesh(geometry,mat);part.castShadow=true;part.receiveShadow=true;
    if(position)part.position.copy(position);if(scale)part.scale.set(...scale);parent.add(part);return part;
  }
  function ball(parent,position,scale,mat=mats.cream){return mesh(parent,new T.SphereGeometry(1,32,24),mat,position,scale);}
  function tube(parent,points,radius,mat){return mesh(parent,new T.TubeGeometry(new T.CatmullRomCurve3(points),24,radius,8,false),mat);}
  function shape(parent,outline,depth,mat,position){return mesh(parent,new T.ExtrudeGeometry(outline,{depth,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:4,steps:1,curveSegments:16}),mat,position);}
  ball(body,v(0,.91,0),[.61,.49,.43]);
  ball(head,v(0,0,0),[.98,.66,.64]);
  function softEar(){
    const geometry=new T.SphereGeometry(1,40,32),position=geometry.attributes.position;
    for(let i=0;i<position.count;i++){
      const y=position.getY(i);
      position.setXYZ(i,position.getX(i)*.27*(1-.60*y),y*.31,position.getZ(i)*.17);
    }
    geometry.computeVertexNormals();return geometry;
  }
  for(const side of [-1,1]){
    const ear=new T.Group();ear.position.set(side*.66,.48,-.05);ear.rotation.z=-side*.18;head.add(ear);
    mesh(ear,softEar(),mats.cream);
    mesh(ear,softEar(),mats.pink,v(0,.025,.132),[.60,.66,.23]);
  }
  const eyes=[];
  for(const side of [-1,1]){
    const eye=ball(head,v(side*.30,-.08,.604),[.078,.105,.045],mats.cocoa);eyes.push(eye);
    const glint=ball(eye,v(-.20,.26,.87),[.13,.10,.11],mats.paper);glint.castShadow=false;
    const cheek=ball(head,v(side*.57,-.245,.472),[.144,.115,.023],mats.pink);cheek.rotation.y=side*.57;
    tube(head,[v(side*.24,.155,.604),v(side*.30,.17,.588),v(side*.36,.158,.574)],.016,mats.cocoa);
  }
  ball(head,v(0,-.228,.615),[.057,.036,.027],mats.cocoa);
  const smile=tube(head,[v(-.12,-.305,.590),v(-.075,-.332,.586),v(0,-.290,.615),v(.075,-.332,.586),v(.12,-.305,.590)],.013,mats.cocoa);
  tube(head,[v(0,-.237,.634),v(0,-.290,.621)],.013,mats.cocoa);
  const mouth=ball(head,v(0,-.305,.606),[.075,.10,.025],mats.cocoa);mouth.visible=false;
  const band=mesh(body,new T.TorusGeometry(.35,.060,10,40),mats.sage,v(0,1.29,0));band.rotation.x=Math.PI/2;
  const scarfShape=new T.Shape();scarfShape.moveTo(-.32,0);scarfShape.quadraticCurveTo(0,-.07,.32,0);scarfShape.lineTo(.055,-.37);scarfShape.quadraticCurveTo(0,-.43,-.055,-.37);scarfShape.closePath();
  const scarf=shape(body,scarfShape,.027,mats.sage,v(0,1.245,.410));scarf.rotation.x=-.1;
  tube(scarf,[v(-.11,-.18,.067),v(-.03,-.255,.067),v(.14,-.085,.067)],.021,mats.paper);
  const tail=new T.Group();body.add(tail);
  tube(tail,[v(-.08,.64,-.32),v(-.47,.69,-.49),v(-.86,.84,-.30),v(-1.03,1.17,-.13)],.085,mats.cream);
  const leafGeometry=new T.SphereGeometry(1,40,32),leafPositions=leafGeometry.attributes.position;
  for(let i=0;i<leafPositions.count;i++){
    const y=leafPositions.getY(i);
    leafPositions.setXYZ(i,leafPositions.getX(i)*.235*(1-Math.abs(y)*.42),y*.29,leafPositions.getZ(i)*.080);
  }
  leafGeometry.computeVertexNormals();
  const leaf=mesh(tail,leafGeometry,mats.sage,v(-1.05,1.26,-.10));leaf.rotation.z=.55;
  const veinMaterial=material('#788965');materials.add(veinMaterial);
  tube(leaf,[v(0,-.22,.055),v(0,-.11,.076),v(0,0,.086),v(0,.13,.075),v(0,.23,.050)],.006,veinMaterial);
  for(const side of [-1,1])tube(leaf,[v(0,-.10,.076),v(side*.06,-.025,.079),v(side*.13,.065,.063)],.004,veinMaterial);

  function limb(position,lengths,radius,bend,foot=false){
    const [upper,lower]=lengths,total=upper+lower;
    // Keep one continuous clay surface; only the small elbow/knee region blends bones.
    const geometry=new T.CapsuleGeometry(radius,total,12,32);geometry.translate(0,-total/2,0);
    const positions=geometry.attributes.position,indices=[],weights=[];
    for(let i=0;i<positions.count;i++){
      const u=Math.max(0,Math.min(1,(-positions.getY(i)-upper+radius*.35)/(radius*.70)));
      const blend=u*u*(3-2*u);
      indices.push(0,1,0,0);weights.push(1-blend,blend,0,0);
    }
    geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));geometries.add(geometry);
    const skin=new T.SkinnedMesh(geometry,mats.cream),hip=new T.Bone(),knee=new T.Bone(),ankle=new T.Bone();
    knee.position.y=-upper;ankle.position.y=-lower;hip.add(knee);knee.add(ankle);skin.add(hip);skin.position.copy(position);skin.castShadow=true;skin.receiveShadow=true;root.add(skin);skin.bind(new T.Skeleton([hip,knee,ankle]));
    const paw=ball(ankle,foot?v(0,-.045,.02):v(0,-.025,.015),foot?[.18,.16,.185]:[.178,.165,.16]);
    if(foot)ball(ankle,v(0,-.185,.07),[.084,.009,.097],mats.pink);
    function target(point){
      const origin=skin.position.clone(),delta=point.clone().sub(origin),distance=Math.min(total-.0001,Math.max(.04,delta.length()));
      const axis=delta.normalize(),along=(upper*upper-lower*lower+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,upper*upper-along*along));
      const outward=bend.clone().addScaledVector(axis,-bend.dot(axis)).normalize();
      const joint=origin.clone().addScaledVector(axis,along).addScaledVector(outward,height),end=origin.clone().addScaledVector(axis,distance);
      const first=new T.Quaternion().setFromUnitVectors(down,joint.clone().sub(origin).normalize());
      const second=new T.Quaternion().setFromUnitVectors(down,end.sub(joint).normalize());
      hip.quaternion.copy(first);knee.quaternion.copy(first.clone().invert().multiply(second));ankle.quaternion.copy(second.clone().invert());
    }
    return {skin,hip,knee,ankle,paw,target,origin:position.clone()};
  }
  const legs=[-1,1].map(side=>limb(v(side*.23,.59,0),[.245,.26],.165,v(0,0,1),true));
  const arms=[-1,1].map(side=>limb(v(side*.44,1.20,.04),[.25,.23],.165,v(side,0,-.15)));

  const props={};
  function prop(name){const group=new T.Group();body.add(group);group.visible=false;props[name]=group;return group;}
  const book=prop('book');book.position.set(0,.95,.50);book.rotation.x=-.28;
  for(const side of [-1,1]){
    const page=new T.Group();book.add(page);page.position.x=side*.15;page.rotation.y=-side*.22;
    mesh(page,new T.BoxGeometry(.29,.34,.030),mats.sage);
    mesh(page,new T.BoxGeometry(.255,.302,.012),mats.paper,v(0,0,.021));
    for(let row=0;row<4;row++)mesh(page,new T.BoxGeometry(.19,.008,.003),mats.sage,v(0,.075-row*.045,.030));
  }
  const keyboard=prop('keyboard');keyboard.position.set(0,.82,.51);
  mesh(keyboard,new T.BoxGeometry(.68,.066,.28),mats.paper);
  for(let row=0;row<3;row++)for(let col=0;col<7;col++)mesh(keyboard,new T.BoxGeometry(.055,.016,.054),mats.sage,v(-.255+col*.085,.046,-.086+row*.086));
  const cup=prop('cup');cup.position.set(0,1.04,.48);
  mesh(cup,new T.CylinderGeometry(.15,.13,.23,24),mats.sage);
  const rim=mesh(cup,new T.TorusGeometry(.137,.016,8,32),mats.paper,v(0,.116,0));rim.rotation.x=Math.PI/2;
  mesh(cup,new T.CircleGeometry(.124,24),mats.cocoa,v(0,.114,0)).rotation.x=-Math.PI/2;
  mesh(cup,new T.TorusGeometry(.09,.022,8,24),mats.sage,v(.174,0,0));
  const umbrella=prop('umbrella');
  mesh(umbrella,new T.CylinderGeometry(.022,.022,1.22,12),mats.cocoa,v(.48,1.68,.12));
  mesh(umbrella,new T.SphereGeometry(.54,32,16,0,Math.PI*2,0,Math.PI/2),mats.sage,v(.48,2.28,.12));

  let currentYaw=.12;
  const handPoints=[v(-.56,.91,.16),v(.56,.91,.16)],motion={drop:0,jump:0,nod:0,tilt:0,blink:0,mouth:0};
  function update(frame,size,now,delta=.016){
    const pose=blendPose(poseFor(frame.pose,size),poseFor(frame.next,size),frame.mix);
    for(const key of Object.keys(motion)){motion[key]=mix(motion[key],pose[key],1-Math.exp(-delta/.045));pose[key]=motion[key];}
    const yaw=frame.phase==='walking'||frame.kind==='dragged'||frame.kind==='landing'?frame.direction*WALK_YAW:.12;
    currentYaw=mix(currentYaw,yaw,1-Math.exp(-delta/.13));root.rotation.y=currentYaw;root.rotation.z=frame.rotation;
    const jump=pose.jump-frame.y*VIEW_WIDTH;
    body.position.y=pose.drop+jump;head.rotation.x=pose.nod;head.rotation.z=pose.tilt;
    for(const eye of eyes)eye.scale.y=.105*(1-pose.blink*.92);
    smile.visible=pose.mouth<.5;mouth.visible=pose.mouth>=.5;
    tail.rotation.y=Math.sin(now/1700)*.035;tail.rotation.z=Math.sin(now/2300)*.022;
    for(const [name,group] of Object.entries(props))group.visible=pose.prop===name;
    const gait=pose.gait;
    const feet=gait?[gait.left,gait.right]:[{x:0,lift:0},{x:0,lift:0}];
    const pixelsPerWorld=size/VIEW_WIDTH;
    for(let i=0;i<2;i++){
      legs[i].skin.position.copy(legs[i].origin);legs[i].skin.position.y+=pose.drop+jump;
      const forward=gait?feet[i].x/(pixelsPerWorld*Math.sin(WALK_YAW)):0;
      legs[i].target(v(legs[i].origin.x,.205+jump+feet[i].lift/pixelsPerWorld,forward));
    }
    for(let i=0;i<2;i++){
      const side=i?1:-1;
      arms[i].skin.position.copy(arms[i].origin);arms[i].skin.position.y+=pose.drop+jump;
      let point=v(side*.56,.91,.16);
      if(gait)point.z-=feet[i].x/pixelsPerWorld*.7;
      if(pose.hands==='chest')point=v(side*.31,1.00,.40);
      if(pose.hands==='book')point=v(side*.31,1.00,.44);
      if(pose.hands==='keyboard')point=v(side*.23,.96+Math.sin(now/110+i*Math.PI)*.025,.44);
      if(pose.hands==='cup')point=v(side*.30,1.04,.43);
      if(pose.hands==='up')point=v(side*.78,1.48,.31);
      if(pose.hands==='think'&&i===1)point=v(.35,1.45,.50);
      if(pose.hands==='wave'&&i===(frame.waveHand==='left'?0:1))point=v(side*(.75+Math.sin(now/180)*.035),1.43,.39);
      if(pose.hands==='umbrella'&&i===1)point=v(.48,1.18,.12);
      point.y+=pose.drop+jump;handPoints[i].lerp(point,1-Math.exp(-delta/.12));arms[i].target(handPoints[i]);
    }
    root.updateMatrixWorld(true);
    return {phase:gait?.phase??0,hands:arms.map(arm=>arm.ankle.getWorldPosition(new T.Vector3()).y),feet:legs.map(leg=>leg.ankle.getWorldPosition(new T.Vector3()).y)};
  }
  function dispose(){for(const geometry of geometries)geometry.dispose();for(const mat of materials)mat.dispose();for(const limb of [...legs,...arms])limb.skin.skeleton.dispose();}
  return {root,update,dispose,arms,legs};
}

function poseFor(pose,size){
  const result={drop:0,jump:0,nod:0,tilt:0,blink:0,mouth:0,hands:'rest',prop:null,gait:null};
  if(pose.atlas==='rig'){const gait=sampleWalk(pose.elapsed,size);return {...result,drop:gait.bodyY/(size/VIEW_WIDTH),gait};}
  if(pose.atlas==='motion'){
    if(pose.index===9)return {...result,drop:-.025,hands:'chest'};
    if(pose.index===10)return {...result,drop:-.065,hands:'chest'};
    if(pose.index===11)return {...result,drop:-.10,nod:.08,hands:'chest'};
    if(pose.index===12)return {...result,drop:-.15,hands:'chest'};
    if(pose.index===13)return {...result,jump:.11,hands:'up'};
    if(pose.index===14)return {...result,jump:.09};
    if(pose.index===15)return {...result,drop:-.13,hands:'chest'};
    return result;
  }
  switch(pose.index){
    case 4:return {...result,drop:-.12,nod:.12,hands:'book',prop:'book'};
    case 5:return {...result,drop:-.10,nod:.16,hands:'keyboard',prop:'keyboard'};
    case 6:return {...result,drop:-.08,tilt:-.07,hands:'think'};
    case 7:return {...result,jump:.23,hands:'up'};
    case 8:return {...result,jump:.19};
    case 9:return {...result,drop:-.12,hands:'chest'};
    case 10:return {...result,nod:-.05,hands:'up'};
    case 11:return {...result,blink:.75,mouth:1,hands:'think'};
    case 12:return {...result,drop:-.09,hands:'cup',prop:'cup'};
    case 13:return {...result,drop:-.12,blink:1,tilt:.12,hands:'chest'};
    case 14:return {...result,hands:'wave'};
    case 15:return {...result,hands:'umbrella',prop:'umbrella'};
    default:return result;
  }
}
function blendPose(a,b,t){
  const result={...(t<.5?a:b)};
  for(const key of ['drop','jump','nod','tilt','blink','mouth'])result[key]=mix(a[key],b[key],t);
  return result;
}
