import {test,expect,_electron as electron} from '@playwright/test';
import {mkdir,readFile,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

test('网页切换账号、退出与重启后，真实桌宠会话自动跟随并隔离任务',async({page},info)=>{
  test.skip(info.project.name!=='desktop','原生窗口只验证一次');
  test.setTimeout(90000);
  const Origin='http://localhost:5174',password='browser-sync-test-password';
  const first={email:`browser-sync-a-${randomUUID()}@example.com`,password},second={email:`browser-sync-b-${randomUUID()}@example.com`,password};
  const register=async(data:typeof first)=>{
    const response=await page.request.post('/api/v1/auth/register',{headers:{Origin},data});
    expect(response.status()).toBe(201);return response.json();
  };
  const b=await register(second);
  expect((await page.request.post('/api/v1/tasks',{headers:{Origin,'X-CSRF-Token':b.csrf_token},data:{title:'第二个账号的任务'}})).status()).toBe(201);
  const a=await register(first);
  expect((await page.request.post('/api/v1/tasks',{headers:{Origin,'X-CSRF-Token':a.csrf_token},data:{title:'第一个账号的任务'}})).status()).toBe(201);
  const pairing=await page.request.post('/api/v1/auth/desktop-link',{headers:{Origin,'X-CSRF-Token':a.csrf_token}});
  expect(pairing.status()).toBe(201);
  const ticket=(await pairing.json()).ticket;
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});
  const root=path.resolve('..');
  const launch=(ticket?:string)=>electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop'),...(ticket?[`xiaoqi-workbench://pet?ticket=${ticket}`]:[])],env:{...process.env,XIAOQI_TEST_DATA:data}});
  let app=await launch();
  const currentUser=()=>app.evaluate(async({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows().find((window:any)=>window.webContents.getURL().startsWith('http://localhost:5174'))!;
    const response=await window.webContents.session.fetch('http://localhost:5174/api/v1/me');
    return response.ok?(await response.json()).user.id:null;
  });
  try{
    await expect.poll(()=>app.windows().some(window=>window.url().startsWith(Origin))).toBe(true);
    let chat=app.windows().find(window=>window.url().startsWith(Origin))!;
    await app.evaluate(({app,dialog},ticket)=>{
      (app as any).syncPrompts=0;
      dialog.showMessageBox=async()=>{(app as any).syncPrompts++;return {response:0,checkboxChecked:false};};
      app.emit('second-instance',{},[`xiaoqi-workbench://chat?ticket=${ticket}`]);
    },ticket);
    await expect.poll(currentUser,{timeout:15000}).toBe(a.user.id);
    await expect(chat.getByRole('region',{name:'小狒 AI 助手',exact:true})).toBeVisible();
    const composer=chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true});
    await composer.fill('重复打开网页后保留这份草稿');
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find((window:any)=>window.webContents.getURL().startsWith('http://localhost:5174'))!.hide();});
    const reopened=await page.request.post('/api/v1/auth/desktop-link',{headers:{Origin,'X-CSRF-Token':a.csrf_token}});
    expect(reopened.status()).toBe(201);
    const autoTicket=(await reopened.json()).ticket;
    await app.evaluate(({app},ticket)=>{app.emit('second-instance',{},[`xiaoqi-workbench://pet?ticket=${ticket}`]);},autoTicket);
    await expect.poll(async()=> (await page.request.post('/api/v1/auth/desktop-link/preview',{headers:{Origin},data:{token:autoTicket}})).status()).toBe(410);
    expect(await app.evaluate(({app})=>(app as any).syncPrompts)).toBe(1);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((window:any)=>window.webContents.getURL().startsWith('http://localhost:5174'))!.isVisible())).toBe(false);
    await expect(composer).toHaveValue('重复打开网页后保留这份草稿');
    await chat.goto(Origin+'/tasks');
    await expect(chat.getByRole('button',{name:'第一个账号的任务',exact:true})).toBeVisible();
    const stored=await readFile(path.join(data,'browser-account-link.bin'));
    expect(()=>JSON.parse(stored.toString('utf8'))).toThrow();
    const login=await page.request.post('/api/v1/auth/login',{headers:{Origin},data:second});
    expect(login.status()).toBe(200);
    const session=await login.json();
    await expect.poll(currentUser,{timeout:15000}).toBe(b.user.id);
    await expect(chat.getByRole('button',{name:'第二个账号的任务',exact:true})).toBeVisible();
    await expect(chat.getByRole('button',{name:'第一个账号的任务',exact:true})).toHaveCount(0);
    await app.close();
    const restartLink=await page.request.post('/api/v1/auth/desktop-link',{headers:{Origin,'X-CSRF-Token':session.csrf_token}});
    expect(restartLink.status()).toBe(201);
    app=await launch((await restartLink.json()).ticket);
    await expect.poll(()=>app.windows().some(window=>window.url().startsWith(Origin))).toBe(true);
    chat=app.windows().find(window=>window.url().startsWith(Origin))!;
    await expect.poll(currentUser,{timeout:15000}).toBe(b.user.id);
    await expect(chat.getByRole('region',{name:'小狒 AI 助手',exact:true})).toBeVisible();
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((window:any)=>window.webContents.getURL().startsWith('http://localhost:5174'))!.isVisible())).toBe(false);
    await chat.goto(Origin+'/account?tab=security');
    await chat.getByRole('button',{name:'退出当前账户',exact:true}).click();
    await expect(chat.getByRole('button',{name:'登录',exact:true})).toBeVisible();
    await expect(access(path.join(data,'browser-account-link.bin'))).rejects.toThrow();
    expect((await (await page.request.get('/api/v1/me')).json()).user.id).toBe(b.user.id);
    const relink=await page.request.post('/api/v1/auth/desktop-link',{headers:{Origin,'X-CSRF-Token':session.csrf_token}});
    expect(relink.status()).toBe(201);
    await app.evaluate(({app,dialog},ticket)=>{
      dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});
      app.emit('second-instance',{},[`xiaoqi-workbench://chat?ticket=${ticket}`]);
    },(await relink.json()).ticket);
    await expect.poll(currentUser,{timeout:15000}).toBe(b.user.id);
    await expect(chat.getByRole('region',{name:'小狒 AI 助手',exact:true})).toBeVisible();
    expect((await page.request.post('/api/v1/auth/logout',{headers:{Origin,'X-CSRF-Token':session.csrf_token}})).status()).toBe(200);
    await expect.poll(currentUser,{timeout:15000}).toBeNull();
    await expect(chat.getByRole('button',{name:'登录',exact:true})).toBeVisible();
  }finally{await app.close();}
});
