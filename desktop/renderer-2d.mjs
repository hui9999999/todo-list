import {PetAnimation} from './animation.mjs';

const urls={base:new URL('./assets/xiaoqi-atlas.png',import.meta.url).href,motion:new URL('./assets/xiaoqi-motion-v2.png',import.meta.url).href};
function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图集无法加载'));image.src=url;});}
// Extract the connected character for display without changing the original PNGs.
function framesOf(image){
  const sourceWidth=image.width/4,sourceHeight=image.height/4,padding=Math.ceil(Math.max(sourceWidth,sourceHeight)*.10);
  const cell=Math.ceil(Math.max(sourceWidth,sourceHeight))+padding*2,frames=[];
  for(let frame=0;frame<16;frame++){
    const surface=document.createElement('canvas');surface.width=cell;surface.height=cell;
    const ctx=surface.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,frame%4*sourceWidth-padding,Math.floor(frame/4)*sourceHeight-padding,sourceWidth+padding*2,sourceHeight+padding*2,0,0,cell,cell);
    const pixels=ctx.getImageData(0,0,cell,cell),visited=new Uint8Array(cell*cell),queue=new Int32Array(cell*cell);let largest=[];
    for(let seed=0;seed<visited.length;seed++){
      if(visited[seed]||pixels.data[seed*4+3]<8)continue;
      let read=0,count=1;queue[0]=seed;visited[seed]=1;
      while(read<count){const p=queue[read++],x=p%cell;for(const n of [x?p-1:-1,x<cell-1?p+1:-1,p-cell,p+cell]){if(n>=0&&n<visited.length&&!visited[n]&&pixels.data[n*4+3]>=8){visited[n]=1;queue[count++]=n;}}}
      if(count>largest.length)largest=Array.from(queue.subarray(0,count));
    }
    const keep=new Uint8Array(cell*cell);let left=cell,top=cell,right=0,bottom=0;
    for(const p of largest){keep[p]=1;left=Math.min(left,p%cell);right=Math.max(right,p%cell);top=Math.min(top,Math.floor(p/cell));bottom=Math.max(bottom,Math.floor(p/cell));}
    for(let p=0;p<keep.length;p++)if(!keep[p])pixels.data[p*4+3]=0;
    ctx.putImageData(pixels,0,0);
    frames.push({surface,x:left,y:top,width:right-left+1,height:bottom-top+1,clipped:left===0||top===0||right===cell-1||bottom===cell-1});
  }
  return frames;
}
export function createPetRenderer(canvas){
  const ctx=canvas.getContext('2d'),animation=new PetAnimation();let frames=null,disposed=false;
  const loaded=Promise.all([loadImage(urls.base),loadImage(urls.motion)]).then(([base,motion])=>{if(!disposed)frames={base:framesOf(base),motion:framesOf(motion)};});
  function draw(target,now,enabled=true){
    if(disposed||!frames)return;
    animation.set(target,now,enabled);const frame=animation.sample(now),size=canvas.getBoundingClientRect().width,ratio=Math.min(devicePixelRatio||1,2);
    if(size<=0)return;
    const resolution=Math.round(size*ratio);if(canvas.width!==resolution||canvas.height!==resolution){canvas.width=resolution;canvas.height=resolution;}
    function resolve(pose){if(pose.atlas==='rig'){const cycle=[0,1,2,3,4,5,6,7];return {atlas:'motion',index:cycle[Math.floor(pose.elapsed/125)%cycle.length]};}return pose;}
    const pose=resolve(frame.pose),next=resolve(frame.next);canvas.dataset.phase=frame.phase;canvas.dataset.frame=pose.atlas+':'+pose.index;canvas.dataset.direction=String(frame.direction);
    canvas.dataset.sourceClipped=String(frames[pose.atlas][pose.index].clipped);
    const mirrored=frame.kind==='dragged'||frame.kind==='landing'?frame.direction>0:frame.kind==='remind'?frame.waveHand==='left':frame.direction<0;
    canvas.dataset.waveHand=frame.waveHand;canvas.dataset.mirrored=String(mirrored);
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,size,size);ctx.save();ctx.translate(size/2,size*.90+frame.y*size);ctx.rotate(frame.rotation);if(mirrored)ctx.scale(-1,1);
    function paint(p,alpha){const source=frames[p.atlas][p.index],scale=size*.82/290;ctx.globalAlpha=alpha;ctx.drawImage(source.surface,source.x,source.y,source.width,source.height,-source.width*scale/2,-source.height*scale,source.width*scale,source.height*scale);}
    paint(pose,1-frame.mix);if(frame.mix>0)paint(next,frame.mix);
    ctx.restore();ctx.globalAlpha=1;
  }
  function dispose(){disposed=true;frames=null;}
  return {draw,loaded,dispose};
}
