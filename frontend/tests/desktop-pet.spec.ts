import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

test('Windows透明桌宠、聊天任务确认、专注庆祝与托盘偏好贯通',async({},info)=>{
  test.skip(info.project.name!=='desktop','原生 Windows 窗口只需验证一次。');
  test.setTimeout(120000);
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});
  const root=path.resolve('..'),instant=new Date().toISOString();
  const rows:any[]=[{id:'focus-task',title:'复习英语单词',scope:'study',status:'doing',version:1,priority:'mid',notes:'',hidden:false,parent_id:null,project_id:null,estimated_minutes:null,due_at:null,due_date:null,due_timezone:null,fail_reason:'',completed_at:null,created_at:instant,updated_at:instant,deleted_at:null,legacy_period:null}, {id:'old-done',title:'以前完成的任务',scope:'life',status:'done',version:1,priority:'low',notes:'',hidden:false,parent_id:null,due_at:null,due_date:null,due_timezone:null,fail_reason:'',completed_at:instant,created_at:instant,updated_at:instant,deleted_at:null,legacy_period:null}];
  let focus:any[]=[],run:any=null,proposal:any=null;
  const messages:any[]=[];const operations:any[]=[];
  const app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data},timeout:30000});
  try{
    await expect.poll(()=>app.windows().length).toBe(2);
    await expect.poll(()=>app.windows().some(page=>page.url().startsWith('file:'))).toBe(true);
    const pet=app.windows().find(page=>page.url().startsWith('file:'))!;
    const chat=app.windows().find(page=>!page.url().startsWith('file:'))!;
    async function shortcutReady(name:string){
      const menu=chat.getByRole('button',{name:'任务快捷操作',exact:true});
      if(await menu.isVisible())await menu.click();
      await expect(chat.getByRole('button',{name,exact:true})).toBeEnabled();
      if(await menu.isVisible())await menu.click();
    }
    await chat.route('**/api/v1/**',route=>{
      const request=route.request(),url=new URL(request.url()),p=url.pathname.replace('/api/v1','');let json:any=[];
      if(p==='/me')json={user:{id:'native-pet-user',email:'native-pet@example.com',nickname:'小辉',timezone:'Asia/Shanghai'},csrf_token:'test'};
      if(p==='/settings')json={version:1,timezone:'Asia/Shanghai',theme:'warm',notifications_enabled:false,weather_enabled:false};
      if(p==='/tasks')json=url.searchParams.has('trash')?[]:rows;
      if(p==='/model-preferences')json={model:'test-model'};
      if(p==='/focus-sessions')json=focus;
      if(p==='/conversations')json=request.method()==='POST'?{id:'native-chat',title:'桌宠对话'}:[{id:'native-chat',title:'桌宠对话'}];
      if(p==='/conversations/native-chat/messages'){
        if(request.method()==='POST'){
          const body=request.postDataJSON();messages.push({id:randomUUID(),role:'user',content:body.content});
          const kind=body.content.includes('删除')?'trash':body.content.includes('修改')?'update':'create';
          const target=rows.find(row=>row.id==='created-task');
          const fields=kind==='create'?{title:'买牛奶',scope:'life',status:'todo',priority:'mid'}:kind==='update'?{...target,priority:'high'}:undefined;
          proposal={id:'proposal-'+messages.length,version:1,state:'pending',reason:'按你的要求调整任务',actions:[{kind,...(kind==='create'?{}:{task_id:target?.id,version:target?.version}),fields}],before:target?[target]:[],result:[],undone:false,expires_at:new Date(Date.now()+600000).toISOString()};
          run={id:'run-'+messages.length,status:'awaiting_confirmation',answer:'请确认任务变更。',proposals:[proposal],created_at:instant};json=run;
        }else json={messages,runs:run?[run]:[]};
      }
      if(p.startsWith('/agent-runs/')){
        if(p.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:`event: done\ndata: ${JSON.stringify({status:run?.status})}\n\n`});
        json=run;
      }
      if(p.startsWith('/action-proposals/')&&p.endsWith('/confirm')){
        const action=proposal.actions[0];operations.push(action.kind);
        if(action.kind==='create')rows.push({...rows[0],...action.fields,id:'created-task',version:1});
        if(action.kind==='update'){const target=rows.find(row=>row.id===action.task_id);target.priority='high';target.version++;}
        if(action.kind==='trash')rows.splice(rows.findIndex(row=>row.id===action.task_id),1);
        proposal.state='accepted';run.status='completed';json=proposal;
      }
      return route.fulfill({json});
    });
    await chat.reload();
    await pet.locator('#pet').click();
    await expect(chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true})).toBeVisible();
    await expect.poll(()=>pet.locator('#status').textContent()).toBe('小狒陪着你');
    await expect.poll(()=>pet.locator('#pet').getAttribute('data-action')).toBe('idle');
    const flags=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map((win:any)=>({title:win.getTitle(),transparent:win.getBackgroundColor(),top:win.isAlwaysOnTop(),node:win.webContents.getLastWebPreferences().nodeIntegration,sandbox:win.webContents.getLastWebPreferences().sandbox})));
    expect(flags.find((item:any)=>item.title==='小狒桌宠')!.top).toBe(true);expect(flags.every((item:any)=>!item.node&&item.sandbox)).toBe(true);
    focus=[{id:'focus-1',task_id:'focus-task',state:'running',duration_seconds:1500,elapsed:150,version:1,started_at:instant,server_now:instant}];
    await expect.poll(()=>pet.locator('#pet').getAttribute('data-action'),{timeout:12000}).toBe('focus');
    await expect(pet.locator('#status')).toContainText('专注');
    await pet.screenshot({path:info.outputPath('pet-focus.png'),omitBackground:true});
    await pet.evaluate(()=>document.body.style.background='#24312c');
    await pet.screenshot({path:info.outputPath('pet-dark-preview.png')});
    await pet.evaluate(()=>document.body.style.background='');
    rows[0].status='done';rows[0].version++;focus=[];
    await expect.poll(()=>pet.locator('#pet').getAttribute('data-action'),{timeout:12000}).toBe('celebrate');
    await expect(pet.locator('#status')).toContainText('复习英语单词');
    await pet.screenshot({path:info.outputPath('pet-celebrate.png'),omitBackground:true});
    await chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).fill('创建任务买牛奶');
    await chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).press('Enter');
    await expect(chat.getByRole('region',{name:'任务操作预览',exact:true})).toContainText('买牛奶');
    expect(rows.some(row=>row.id==='created-task')).toBe(false);
    await chat.getByRole('button',{name:'确认这些变更',exact:true}).click();
    await expect.poll(()=>operations).toEqual(['create']);
    await shortcutReady('修改任务');
    await chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).fill('修改买牛奶的优先级为高');await chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).press('Enter');
    await chat.getByRole('button',{name:'确认这些变更',exact:true}).click();
    await expect.poll(()=>rows.find(row=>row.id==='created-task').priority).toBe('high');
    await shortcutReady('删除任务');
    await chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).fill('删除任务买牛奶');await chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).press('Enter');
    await chat.getByRole('button',{name:'确认这些变更',exact:true}).click();
    await expect.poll(()=>operations).toEqual(['create','update','trash']);
    await chat.screenshot({path:info.outputPath('pet-chat.png'),fullPage:true});
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()!=='小狒桌宠')!;win.setSize(1120,820);win.webContents.send('desktop:navigate','/account');});
    await chat.locator('.preferences-companion > summary').click();
    const settings=chat.getByRole('region',{name:'小狒桌宠设置',exact:true});
    await expect(settings.getByRole('checkbox',{name:'显示小狒',exact:true})).toBeChecked();
    await settings.getByText('显示小狒',{exact:true}).click();
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.isVisible())).toBe(false);
    await settings.getByText('显示小狒',{exact:true}).click();
    await chat.screenshot({path:info.outputPath('pet-settings.png')});
    await chat.evaluate(()=>window.xiaoqiDesktop!.setSettings({visible:false,motion:false,wander:false,size:120}));
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.isVisible())).toBe(false);
    await chat.evaluate(()=>window.xiaoqiDesktop!.setSettings({visible:true,size:160,position:null}));
    await expect(pet.locator('body')).toHaveClass(/motion-off/);
    const before=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.getBounds());
    const bounds=await pet.locator('#pet').boundingBox();
    await pet.mouse.move(bounds!.x+100,bounds!.y+100);await pet.mouse.down();await pet.mouse.move(bounds!.x+80,bounds!.y+80);
    await expect(pet.locator('#pet')).toHaveAttribute('data-action','dragged');
    await pet.mouse.move(bounds!.x+65,bounds!.y+65);await pet.mouse.up();
    await expect(pet.locator('#pet')).toHaveAttribute('data-action','landing');
    const after=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.getBounds());
    expect(after.x).toBeLessThan(before.x);expect(after.y).toBeLessThan(before.y);
    const saved=JSON.parse(await readFile(path.join(data,'pet-preferences.json'),'utf8'));
    expect(saved.position).toEqual({x:after.x,y:after.y});expect(saved.motion).toBe(false);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()!=='小狒桌宠')!.close());
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(2);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()!=='小狒桌宠')!.isVisible())).toBe(false);
    await pet.locator('#pet').click();
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()!=='小狒桌宠')!.isVisible())).toBe(true);
  } finally {await app.close();}
});
