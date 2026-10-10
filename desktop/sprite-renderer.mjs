export function createPetRenderer(canvas,initialStyle='3d'){
  let renderer=null,activeStyle='',requestedStyle='',generation=0,disposed=false,loading;
  async function setStyle(value){
    const style=value==='2d'?'2d':'3d';
    if(disposed)return;if(style===requestedStyle)return loading;
    requestedStyle=style;const ticket=++generation;delete canvas.dataset.error;
    loading=(async()=>{
      let candidate;
      try{
        const module=style==='2d'?await import('./renderer-2d.mjs'):await import('./renderer-3d.mjs');
        if(disposed||ticket!==generation)return;
        candidate=module.createPetRenderer(canvas);await candidate.loaded;
        if(disposed||ticket!==generation){candidate.dispose();return;}
        renderer?.dispose();renderer=candidate;activeStyle=style;
        if(style==='2d'){delete canvas.dataset.handHeight;delete canvas.dataset.footHeight;}
        canvas.dataset.ready='true';canvas.dataset.renderer=style==='2d'?'two-dimensional':'three-dimensional';
      }catch(error){candidate?.dispose();if(!disposed&&ticket===generation)canvas.dataset.error='动画暂时无法播放';throw error;}
    })();
    return loading;
  }
  const loaded=setStyle(initialStyle);
  function draw(target,now,enabled=true){
    if(disposed)return;
    if(target.renderStyle&&target.renderStyle!==requestedStyle)void setStyle(target.renderStyle).catch(()=>{});
    renderer?.draw(target,now,enabled);
    if(renderer)canvas.dataset.renderer=activeStyle==='2d'?'two-dimensional':'three-dimensional';
  }
  function dispose(){disposed=true;generation++;renderer?.dispose();renderer=null;}
  return {draw,loaded,setStyle,dispose};
}
