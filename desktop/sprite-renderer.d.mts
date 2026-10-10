export type PetRenderStyle='2d'|'3d';
export type PetTarget={kind:string;index:number;direction?:number;waveHand?:'left'|'right';walkElapsed?:number;renderStyle?:PetRenderStyle};
export function createPetRenderer(canvas:HTMLCanvasElement,initialStyle?:PetRenderStyle):{draw:(target:PetTarget,now:number,enabled?:boolean)=>void;loaded:Promise<void>;setStyle:(style:PetRenderStyle)=>Promise<void>;dispose:()=>void};
