// Native movement is 1 DIP / 40ms. Scale stride and period together so planted
// paws remain stationary in desktop coordinates at all three configured sizes.
export function sampleWalk(elapsed,size){
  const period=size/100*1000,phase=((elapsed/period)%1+1)%1,amplitude=size/16;
  function foot(p){
    p%=1;
    if(p<.5)return {x:amplitude*(1-4*p),lift:0};
    const u=(p-.5)*2;
    // Continuous horizontal velocity at toe-off and contact, rather than a
    // repeated still frame or a sudden reversal of the leg.
    const forward=-4*u*u*u+6*u*u-u;
    return {x:-amplitude+2*amplitude*forward,lift:Math.sin(Math.PI*u)**2*size*.018};
  }
  return {phase,left:foot(phase),right:foot((phase+.5)%1),bodyY:-size*.002*(1-Math.cos(phase*Math.PI*4))};
}
