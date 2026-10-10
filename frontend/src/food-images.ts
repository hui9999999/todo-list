// Share decoded images between previews so a transition never starts on an empty frame.
const pending=new Map<string,Promise<void>>();
export function preloadFoodImage(source:string):Promise<void> {
  const cached=pending.get(source);
  if(cached)return cached;
  const ready=new Promise<void>((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{image.decode().catch(()=>{}).then(resolve);};
    image.onerror=()=>{pending.delete(source);reject(new Error('菜品图片暂时无法加载，请重试。'));};
    image.src=source;
  });
  pending.set(source,ready);
  return ready;
}
