export type Theme = 'light' | 'dark' | 'warm';
export interface ThemeOption {id:string; family:Theme; name:string; description:string; bg:string; surface:string; sidebar:string; text:string; secondary:string; border:string; accent:string}
export const themeOptions:ThemeOption[] = [
  {id:'light',family:'light',name:'清爽浅色',description:'白色底面，清晰直接',bg:'#f7f9f8',surface:'#ffffff',sidebar:'#edf2ee',text:'#253b35',secondary:'#62776c',border:'#dce5e0',accent:'#28715c'},
  {id:'dark-forest',family:'dark',name:'松林夜色',description:'深绿底面，柔和绿光',bg:'#17221e',surface:'#1e2c25',sidebar:'#1b2b22',text:'#e2eee7',secondary:'#a0b1a7',border:'#3a4b41',accent:'#7bb99c'},
  {id:'dark-slate',family:'dark',name:'石墨夜色',description:'中性灰黑，低调利落',bg:'#1b1e23',surface:'#242930',sidebar:'#20242a',text:'#e7eaef',secondary:'#abb2bd',border:'#424a56',accent:'#a2b2cc'},
  {id:'dark-midnight',family:'dark',name:'午夜蓝',description:'沉静深蓝，冷色层次',bg:'#151e2b',surface:'#202d3d',sidebar:'#1a2635',text:'#e1e8f2',secondary:'#a5b7ca',border:'#3c5064',accent:'#8fbbdc'},
  {id:'warm-paper',family:'warm',name:'奶油纸张',description:'柔白纸感，淡淡茶色',bg:'#faf7f0',surface:'#fffdf8',sidebar:'#f0eade',text:'#40392f',secondary:'#786f63',border:'#ddd3c2',accent:'#826635'},
  {id:'warm-sand',family:'warm',name:'杏仁沙色',description:'温暖沙色，铜色点缀',bg:'#f4ece0',surface:'#fbf5ea',sidebar:'#ede0cb',text:'#4e4031',secondary:'#82705c',border:'#d8c7b0',accent:'#9b623b'},
  {id:'warm-rose',family:'warm',name:'浅玫瑰',description:'轻柔粉白，克制玫瑰色',bg:'#faf3f1',surface:'#fff9f7',sidebar:'#f1e4e0',text:'#503c3a',secondary:'#866d69',border:'#e0cac5',accent:'#a85e58'},
];
const defaults:Record<Theme,string> = {light:'light',dark:'dark-forest',warm:'warm-paper'};
const preferenceKey = 'todo-v2-theme-palettes';
export function isTheme(value:unknown):value is Theme {return value === 'light' || value === 'dark' || value === 'warm';}
function preferences():Partial<Record<Theme,string>> {
  try { const value=JSON.parse(localStorage.getItem(preferenceKey) || '{}'); return value && typeof value === 'object' ? value : {}; }
  catch { return {}; }
}
export function storedTheme():Theme {
  try {const value=localStorage.getItem('todo-v2-theme');return isTheme(value)?value:'light';} catch {return 'light';}
}
export function themeOption(id:string):ThemeOption {return themeOptions.find(option=>option.id === id) || themeOptions[0]!;}
export function selectedTheme(base:Theme):string {
  const id=preferences()[base]; return themeOptions.some(option=>option.id === id && option.family === base) ? id! : defaults[base];
}
function mix(first:string,second:string,weight:number) {
  const values=[0,2,4].map(offset=>Math.round(parseInt(first.slice(offset+1,offset+3),16)*weight+parseInt(second.slice(offset+1,offset+3),16)*(1-weight)));
  return '#'+values.map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function renderTheme(id:string) {
  const option=themeOption(id),root=document.documentElement,style=root.style;
  root.dataset.theme=option.family;root.dataset.palette=option.id;
  const values:Record<string,string> = {
    '--workbench-bg':option.bg,'--workbench-sidebar':option.sidebar,'--workbench-button-text':option.family === 'dark' ? option.bg : '#ffffff',
    '--el-bg-color':option.surface,'--el-bg-color-page':option.bg,'--el-bg-color-overlay':mix(option.text,option.surface,.06),
    '--el-fill-color-blank':option.surface,'--el-fill-color':mix(option.text,option.surface,.08),'--el-fill-color-light':mix(option.text,option.surface,.04),'--el-fill-color-lighter':mix(option.text,option.surface,.02),'--el-fill-color-extra-light':mix(option.text,option.surface,.01),'--el-fill-color-dark':mix(option.text,option.surface,.12),'--el-fill-color-darker':mix(option.text,option.surface,.18),
    '--el-text-color-primary':option.text,'--el-text-color-regular':mix(option.text,option.secondary,.72),'--el-text-color-secondary':option.secondary,'--el-text-color-placeholder':option.secondary,'--el-text-color-disabled':mix(option.secondary,option.surface,.65),
    '--el-border-color':option.border,'--el-border-color-light':mix(option.border,option.surface,.8),'--el-border-color-lighter':mix(option.border,option.surface,.6),'--el-border-color-extra-light':mix(option.border,option.surface,.4),
    '--el-color-primary':option.accent,'--el-color-primary-dark-2':mix(option.accent,option.family === 'dark' ? '#ffffff' : option.text,.82),
    '--el-mask-color':option.family === 'dark' ? 'rgba(0,0,0,.55)' : 'rgba(25,31,28,.35)',
  };
  for(const level of [3,5,7,8,9])values['--el-color-primary-light-'+level]=mix(option.accent,option.surface,(10-level)/10);
  for(const [key,value] of Object.entries(values))style.setProperty(key,value);
}
export function applyTheme(base:Theme) {
  renderTheme(selectedTheme(base));
  try {localStorage.setItem('todo-v2-theme',base);} catch { /* Appearance still applies without storage. */ }
}
export function rememberTheme(id:string) {
  const option=themeOption(id);
  try {localStorage.setItem(preferenceKey,JSON.stringify({...preferences(),[option.family]:option.id}));localStorage.setItem('todo-v2-theme',option.family);} catch { /* Keep the selected appearance for this session. */ }
  renderTheme(option.id);
}
export const settingKeys=['version','timezone','memory_enabled','followups_enabled','news_enabled','news_topics','suggestions_enabled','notifications_enabled','weather_enabled','weather_city','theme','work_start','work_end','recommendation_time','daily_capacity','daily_call_limit','daily_token_limit'] as const;
