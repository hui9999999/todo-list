'use strict';
// Use Electron's download/cache/checksum validation, with the Windows network
// client so local proxy/DNS settings work consistently with this environment.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {downloadArtifact}=require('@electron/get');
const electronDirectory=path.dirname(require.resolve('electron/package.json'));
const {version}=require('electron/package.json');
const dist=path.join(electronDirectory,'dist');
if(fs.existsSync(path.join(dist,'electron.exe'))){process.exit(0);}
if(process.platform!=='win32')throw new Error('小狒桌面运行时需要 Windows。');
function run(command,args){return new Promise((resolve,reject)=>{const process=spawn(command,args,{stdio:'inherit',windowsHide:true});process.on('error',reject);process.on('exit',code=>code===0?resolve():reject(new Error(command+' exited '+code)));});}
async function install(){
  console.log('正在安装小狒桌面运行时…');
  const zip=await downloadArtifact({version,artifactName:'electron',platform:'win32',arch:process.arch,checksums:require('electron/checksums.json'),cacheRoot:path.join(__dirname,'.cache'),downloader:{download:(url,destination)=>run('curl.exe',['--fail','--location','--silent','--show-error','--connect-timeout','20','--max-time','900','--retry','2','--continue-at','-','--output',destination,url])}});
  const {extract}=require('@electron-internal/extract-zip');
  await extract(zip,{dir:dist});
  fs.writeFileSync(path.join(electronDirectory,'path.txt'),'electron.exe');
  console.log('小狒桌面运行时已就绪。');
}
install().catch(error=>{console.error(error.message);process.exitCode=1;});
