import {test,expect,_electron as electron} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {recordTask} from './task-entry';

test('桌面聊天、清单与专注同窗切换，保留草稿附件和专注休息计时',async({},info)=>{
  test.skip(info.project.name!=='desktop','原生窗口只验证一次');
  test.setTimeout(45000);
  const data=info.outputPath('native-profile');await mkdir(data,{recursive:true});
  const root=path.resolve('..'),instant=new Date().toISOString();
  const rows:any[]=[{id:'today-task',title:'整理今天的笔记',notes:'',scope:'study',priority:'mid',status:'todo',hidden:false,parent_id:null,version:1,due_at:null,due_date:null,completed_at:null,created_at:instant,updated_at:instant,deleted_at:null}];
  const plans:any[]=[{id:'today-plan',task_id:'today-task',plan_date:instant.slice(0,10)}];
  const sessions:any[]=[];
  let conversationLoads=0;
  const app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env:{...process.env,XIAOQI_TEST_DATA:data}});
  try{
    await expect.poll(()=>app.windows().some(page=>page.url().startsWith('file:'))).toBe(true);
    const pet=app.windows().find(page=>page.url().startsWith('file:'))!;
    const chat=app.windows().find(page=>!page.url().startsWith('file:'))!;
    await expect.poll(()=>chat.url()).toContain('localhost:5174');await chat.waitForLoadState('load');
    const errors:string[]=[];chat.on('pageerror',error=>errors.push(error.message));
    await chat.route('**/api/v1/**',route=>{
      const request=route.request(),url=new URL(request.url()),p=url.pathname.replace('/api/v1','');let json:any=[];
      if(p==='/me')json={user:{id:'switch-user',nickname:'小辉',timezone:'Asia/Shanghai'},csrf_token:'test'};
      if(p==='/settings')json={version:1,theme:'warm',weather_enabled:false,notifications_enabled:false};
      if(p==='/model-preferences')json={model:'test-model'};
      if(p==='/conversations'){conversationLoads++;json=[];}
      if(p==='/tasks'){
        if(request.method()==='POST'){const fields=request.postDataJSON();const row={...rows[0],...fields,id:'new-task',status:'todo',scope:'life',version:1};rows.push(row);json=row;}
        else json=url.searchParams.has('trash')?[]:rows;
      }
      if(p==='/tasks/today-task' && request.method()==='PUT'){Object.assign(rows[0],request.postDataJSON(),{version:rows[0].version+1});json=rows[0];}
      if(p==='/daily-plans'){
        if(request.method()==='POST'){const plan={...request.postDataJSON(),id:'new-plan'};plans.push(plan);json=plan;}
        else json=plans;
      }
      if(p.startsWith('/focus-sessions')){
        const now=Date.now();
        if(request.method()==='POST'){
          const body=request.postDataJSON();
          if(p==='/focus-sessions')sessions.unshift({id:'native-focus',task_id:body.task_id,state:'running',duration_seconds:body.minutes*60,elapsed:0,anchor:now,started_at:new Date(now).toISOString(),version:1});
          else{
            const row=sessions.find(row=>p.endsWith('/'+row.id));expect(body.version).toBe(row.version);
            if(row.state==='running')row.elapsed+=Math.floor((now-row.anchor)/1000);
            row.anchor=now;row.version++;
            row.state=({pause:'paused',resume:'running',finish:'completed',cancel:'cancelled'} as Record<string,string>)[body.action];
          }
        }
        json=sessions.map(row=>({...row,elapsed:row.elapsed+(row.state==='running'?Math.floor((now-row.anchor)/1000):0)}));
      }
      return route.fulfill({json});
    });
    await chat.reload();await pet.locator('#pet').click();
    await chat.evaluate(()=>window.xiaoqiDesktop!.setSettings({wander:false}));
    const switcher=chat.getByRole('navigation',{name:'桌面页面切换',exact:true});
    const message=chat.getByRole('textbox',{name:'发给 AI 的消息',exact:true});
    await expect(switcher.getByRole('link',{name:'聊天',exact:true})).toHaveAttribute('aria-current','page');
    await expect(message).toBeVisible();await expect.poll(()=>conversationLoads).toBe(1);
    await message.fill('这是一段还没发送的消息');
    await chat.locator('#chat-attachments').setInputFiles({name:'计划.md',mimeType:'text/markdown',buffer:Buffer.from('# 今日计划')});
    await expect(chat.getByRole('list',{name:'待发送附件'})).toContainText('计划.md');
    const initialSize=await chat.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await switcher.getByRole('link',{name:'清单',exact:true}).click();
    await expect(chat).toHaveURL(/\/today$/);
    await expect(switcher.getByRole('link',{name:'清单',exact:true})).toHaveAttribute('aria-current','page');
    await expect(chat.getByRole('heading',{name:'今日清单',exact:true})).toBeVisible();
    await expect(chat.getByRole('navigation',{name:'工作区',exact:true})).toBeHidden();
    await expect(chat.getByRole('article',{name:'整理今天的笔记',exact:true})).toBeVisible();
    await chat.getByRole('button',{name:'完成：整理今天的笔记',exact:true}).click();
    await expect.poll(()=>rows[0].status).toBe('done');
    await recordTask(chat,'买牛奶');
    await expect(chat.getByRole('article',{name:'买牛奶',exact:true})).toBeVisible();
    expect(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await chat.screenshot({path:info.outputPath('desktop-today.png')});
    await switcher.getByRole('link',{name:'专注',exact:true}).click();
    await expect(chat).toHaveURL(/\/focus$/);
    await expect(switcher.getByRole('link',{name:'专注',exact:true})).toHaveAttribute('aria-current','page');
    await expect(chat.getByRole('navigation',{name:'工作区',exact:true})).toBeHidden();
    await chat.getByRole('combobox',{name:'专注任务',exact:true}).click();
    await chat.getByRole('option',{name:'买牛奶',exact:true}).click();
    await chat.getByRole('button',{name:'开始专注',exact:true}).click();
    await expect(chat.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
    await expect.poll(()=>pet.locator('#status').textContent()).toMatch(/^专注 /);
    await switcher.getByRole('link',{name:'聊天',exact:true}).click();
    await expect(message).toHaveValue('这是一段还没发送的消息');
    await switcher.getByRole('link',{name:'专注',exact:true}).click();
    await chat.getByRole('button',{name:'暂停',exact:true}).click();
    await expect(chat.getByRole('button',{name:'继续',exact:true})).toBeVisible();
    const frozen=await chat.locator('.focus-clock').textContent();
    await switcher.getByRole('link',{name:'清单',exact:true}).click();
    await switcher.getByRole('link',{name:'专注',exact:true}).click();
    await expect(chat.getByRole('button',{name:'继续',exact:true})).toBeVisible();
    await expect(chat.locator('.focus-clock')).toHaveText(frozen!);
    await chat.getByRole('button',{name:'继续',exact:true}).click();
    await chat.getByRole('button',{name:'结束并记录',exact:true}).click();
    await expect(chat.getByRole('button',{name:'短休息',exact:true})).toHaveAttribute('aria-pressed','true');
    await chat.getByRole('button',{name:'开始休息',exact:true}).click();
    await switcher.getByRole('link',{name:'聊天',exact:true}).click();
    await expect.poll(()=>pet.locator('#status').textContent(),{timeout:12000}).toMatch(/^休息 /);
    await switcher.getByRole('link',{name:'专注',exact:true}).click();
    await expect(chat.getByRole('button',{name:'暂停休息',exact:true})).toBeVisible();
    expect(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await chat.screenshot({path:info.outputPath('desktop-focus.png'),fullPage:true});
    expect(await chat.evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual(initialSize);
    await switcher.getByRole('link',{name:'聊天',exact:true}).click();
    await expect(message).toHaveValue('这是一段还没发送的消息');
    await expect(chat.getByRole('list',{name:'待发送附件'})).toContainText('计划.md');
    expect(conversationLoads).toBe(1);
    expect(await chat.evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual(initialSize);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(2);
    await chat.screenshot({path:info.outputPath('desktop-chat.png')});
    expect(errors).toEqual([]);
  }finally{await app.close();}
});
