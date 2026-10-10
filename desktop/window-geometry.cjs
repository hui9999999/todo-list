'use strict';
// With fractional Windows DPI, setPosition() round-trips the current bounds
// and can add a pixel on every move. Always send the chosen size with position.
function setPetBounds(win,position,size){
  const locked=!win.isResizable();
  if(locked)win.setResizable(true);
  try{win.setBounds({x:Math.round(position.x),y:Math.round(position.y),width:size+48,height:size+86});}
  finally{if(locked)win.setResizable(false);}
}
module.exports={setPetBounds};
