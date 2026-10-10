const old = index => ({atlas:'base',index});
const middle = index => ({atlas:'motion',index});
const seated = new Set(['focus','rest','sleep','think']);
const smooth = t => t*t*(3-2*t);
const walking = elapsed => ({atlas:'rig',index:0,elapsed});
export class PetAnimation {
  constructor(){this.target={kind:'idle',index:0,direction:1};this.started=0;this.steps=[];this.pending=null;this.enabled=true;}
  set(target,now,enabled=true){
    if(!enabled){this.target=target;this.steps=[];this.pending=null;this.enabled=false;return;}
    this.enabled=true;
    if(target.kind===this.target.kind && target.index===this.target.index && target.waveHand===this.target.waveHand){this.target=target;this.pending=null;return;}
    // A celebration completes its first jump; dragging always takes precedence.
    if(this.target.kind==='celebrate' && now-this.started<720 && target.kind!=='dragged'){this.pending=target;return;}
    const current=this.sample(now),from=current.mix>.5?current.next:current.pose;
    const previous=this.target;
    this.target=target;this.started=now;this.pending=null;
    if(target.kind==='dragged')this.steps=[{pose:middle(14),duration:65}];
    else if(target.kind==='landing'||previous.kind==='dragged')this.steps=[{pose:middle(15),duration:110},{pose:middle(10),duration:90}];
    else if(target.kind==='celebrate')this.steps=[{pose:from,duration:35}];
    else {
      this.steps=[{pose:from,duration:35},{pose:middle(seated.has(previous.kind)?10:9),duration:90},
        {pose:middle(seated.has(target.kind)?11:8),duration:90}];
    }
  }
  sample(now){
    if(this.pending && now-this.started>=720){const next=this.pending;this.pending=null;this.set(next,now,this.enabled);}
    const {kind,index,direction=1,waveHand='right'}=this.target;
    const facing=['walking','dragged','landing'].includes(kind)?direction:1;
    let elapsed=Math.max(0,now-this.started),transition=this.steps.length>0;
    const resting=()=>({pose:kind==='landing'?middle(8):old(index),next:kind==='landing'?middle(8):old(index),mix:0,y:0,rotation:0,direction:facing,kind,waveHand,phase:'settled'});
    if(!this.enabled)return resting();
    for(let i=0;i<this.steps.length;i++){
      const step=this.steps[i];
      if(elapsed<step.duration){
        const next=this.steps[i+1]?.pose || (kind==='walking'?walking(0):kind==='celebrate'?middle(12):kind==='landing'?middle(8):old(index));
        return {pose:step.pose,next,mix:smooth(Math.max(0,(elapsed-step.duration+18)/18)),y:0,rotation:0,direction:facing,kind,waveHand,phase:'transition'};
      }
      elapsed-=step.duration;
    }
    if(kind==='walking'){
      const time=Number.isFinite(this.target.walkElapsed)?Math.max(0,this.target.walkElapsed):elapsed;
      return {pose:walking(time),next:walking(time),mix:0,y:0,rotation:0,direction,phase:'walking'};
    }
    if(kind==='celebrate'){
      const cycle=[{pose:middle(12),duration:100},{pose:middle(13),duration:80},{pose:old(7),duration:200},{pose:middle(15),duration:120},{pose:middle(10),duration:100},{pose:middle(8),duration:120}];
      let t=elapsed%720;
      for(let i=0;i<cycle.length;i++){const step=cycle[i];if(t<step.duration){return {pose:step.pose,next:cycle[(i+1)%cycle.length].pose,mix:smooth(Math.max(0,(t-step.duration+18)/18)),y:i===2?-.035*Math.sin(t/step.duration*Math.PI):0,rotation:0,direction:1,phase:'celebrate'};}t-=step.duration;}
    }
    const result=resting();
    result.y=kind==='sleep'?0:-.004*(1-Math.cos(elapsed/3200*Math.PI*2));
    result.rotation=kind==='dragged'?Math.sin(elapsed/600*Math.PI*2)*.05:kind==='think'?Math.sin(elapsed/2600*Math.PI*2)*.018:0;
    return result;
  }
}
