const reactions=Object.freeze([
  {id:'wave-right',index:14,kind:'remind',waveHand:'right',label:'嗨，我在这里',duration:1800},
  {id:'wave-left',index:14,kind:'remind',waveHand:'left',label:'嗨，我在这里',duration:1800},
  {id:'stretch',index:10,kind:'stretch',label:'一起伸个懒腰吧',duration:2100},
  {id:'yawn',index:11,kind:'yawn',label:'歇一小会儿',duration:2100},
  {id:'drink',index:12,kind:'rest',label:'喝口水，慢慢来',duration:2400},
]);

export function canHoverReact(packet,{now=Date.now(),dragging=false,pressed=false,reduced=false}={}){
  const state=packet.state;
  return Boolean(packet.options.motion && !reduced && !dragging && !pressed && !packet.walking &&
    !(state.celebrateUntil>now) && !state.focus && !state.break &&
    !['thinking','confirm','error'].includes(state.aiStatus));
}

export class HoverReactions {
  constructor(random=Math.random){this.random=random;this.hovering=false;this.active=null;this.nextAt=Infinity;this.cooldownUntil=0;this.previousKind='';}
  enter(now){if(this.hovering)return;this.hovering=true;this.nextAt=Math.max(now+180,this.cooldownUntil);}
  leave(){this.hovering=false;this.nextAt=Infinity;}
  cancel(){this.leave();this.active=null;}
  sample(now,allowed=true){
    if(!allowed){this.cancel();return null;}
    if(this.active && now<this.active.until)return this.active;
    this.active=null;
    if(!this.hovering || now<this.nextAt)return null;
    const pool=reactions.filter(reaction=>reaction.kind!==this.previousKind);
    const choice=pool[Math.min(pool.length-1,Math.floor(Math.max(0,this.random())*pool.length))];
    this.active={...choice,until:now+choice.duration};this.previousKind=choice.kind;
    this.cooldownUntil=this.active.until+2200;this.nextAt=this.active.until+4800;
    return this.active;
  }
}

export class DragFacing {
  constructor(){this.direction=1;this.x=0;}
  start(x){this.x=x;}
  move(x){const delta=x-this.x;if(Math.abs(delta)>=3){this.direction=Math.sign(delta);this.x=x;}return this.direction;}
}
