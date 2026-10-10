'use strict';

// Native leases end before the server restores the web pet (8s vs 12s).
function createPetPresence({managed=false,now=Date.now,onChange=()=>{}}={}){
  let visible=!managed,expiresAt=0;
  function set(value){if(visible!==value){visible=value;onChange(value);}}
  function check(){if(managed&&now()>=expiresAt)set(false);return visible;}
  return {
    allowed:check,
    wait(){managed=true;expiresAt=0;set(false);},
    grant(value){managed=true;expiresAt=Number.isFinite(value.expiresAt)?value.expiresAt:0;set(Boolean(value.allowed)&&expiresAt>now());},
  };
}
module.exports={createPetPresence};
