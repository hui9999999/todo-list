'use strict';
const path=require('node:path');
const bounds=require('./assets/frame-bounds.json')['xiaoqi-atlas'][0];

// Reuse the original 2D character, tightly framed for small Windows icons.
function createAppIcon(nativeImage){
  const atlas=nativeImage.createFromPath(path.join(__dirname,'assets','xiaoqi-atlas.png'));
  const [x,y,width,height]=bounds;
  return atlas.crop({x,y,width,height}).resize({width:256,height:256,quality:'best'});
}
module.exports={createAppIcon};
