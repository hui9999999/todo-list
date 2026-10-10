import {test,expect,type Page} from '@playwright/test';

async function workspace(page:Page){
  const chats:any[]=[],requests:string[]=[];
  let userId='retention-a';
  let run:any=null, sent='',finished=false,release!:()=>void;
  const delivery=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','');let json:any=[];
    requests.push(req.method()+' '+path);
    if(path==='/me')json={user:{id:userId,nickname:'测试用户',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={version:1,theme:'light',weather_enabled:false,news_enabled:false,suggestions_enabled:false};
    if(path==='/model-preferences')json={model:'test'};
    if(path==='/history/search')json={hits:[],message:''};
    if(path==='/conversations'){
      if(req.method()==='POST')chats.unshift({id:'chat-'+chats.length,title:'对话 '+(chats.length+1),user_id:userId});
      json=req.method()==='POST'?chats[0]:chats.filter(c=>c.user_id===userId);
    }
    if(/\/conversations\/chat-\d\/messages/.test(path)){
      const index=Number(path.match(/chat-(\d)/)![1]);
      if(req.method()==='POST'){
        sent=req.postDataJSON().content;
        run={id:'retention-run',status:'running',proposals:[]};
        return route.fulfill({status:202,json:run});
      }
      const messages:any[]=[{id:'opening-'+index,role:'assistant',content:'小狒在这里，这是第 '+(index+1)+' 段对话。'}];
      if(sent)messages.push({id:'user-message',role:'user',content:sent});
      if(finished)messages.push({id:'answer',role:'assistant',content:'我已经想好了，我们先整理第一步。'});
      json={messages,runs:run?[run]:[]};
    }
    if(path==='/agent-runs/retention-run')json=run;
    if(path==='/agent-runs/retention-run/events'){
      await delivery;finished=true;run={...run,status:'completed',answer:'我已经想好了，我们先整理第一步。'};
      return route.fulfill({contentType:'text/event-stream',body:'id: 1\nevent: answer_delta\ndata: {"text":"我已经想好了，我们先整理第一步。"}\n\nid: 2\nevent: done\ndata: {"status":"completed"}\n\n'});
    }
    await route.fulfill({json});
  });
  await page.goto('/ai');
  const input=page.getByRole('textbox',{name:'发给 AI 的消息',exact:true});
  const nav=page.getByRole('navigation',{name:'工作区',exact:true});
  return {chats,requests,input,nav,release,setUser:(id:string)=>{userId=id;}};
}

test('切到日历期间收到回答，返回助手仍显示完整对话',async({page})=>{
  const {input,nav,requests,release}=await workspace(page);
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText('小狒在这里，这是第 1 段对话。',{exact:true})).toBeVisible();
  await input.fill('帮我整理一下思路');await input.press('Enter');
  await expect.poll(()=>requests.some(r=>r==='GET /agent-runs/retention-run/events')).toBe(true);
  await nav.getByRole('link',{name:'日历',exact:true}).click();
  release();
  await expect.poll(()=>requests.filter(r=>r==='GET /conversations/chat-0/messages').length).toBeGreaterThanOrEqual(3);
  await nav.getByRole('link',{name:'AI 助手',exact:true}).click();
  await expect(page.getByText('帮我整理一下思路',{exact:true})).toBeVisible();
  await expect(page.getByText('我已经想好了，我们先整理第一步。',{exact:true})).toBeVisible();
  expect(requests.filter(r=>r==='POST /conversations/chat-0/messages')).toHaveLength(1);
});

test('跨清单日历资讯返回助手，当前对话、草稿和附件保持',async({page},info)=>{
  const {input,nav,requests}=await workspace(page);
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText('小狒在这里，这是第 1 段对话。',{exact:true})).toBeVisible();
  await input.fill('还没发出的想法，等一下接着聊');
  await page.getByLabel('选择聊天附件',{exact:true}).setInputFiles({name:'随手笔记.txt',mimeType:'text/plain',buffer:Buffer.from('一些想法')});
  await expect(page.getByLabel('待发送附件')).toContainText('随手笔记.txt');
  for(const name of ['日历','资讯','清单']){
    await nav.getByRole('link',{name:new RegExp('^'+name)}).click();
    await expect(input).toBeHidden();
    await nav.getByRole('link',{name:'AI 助手',exact:true}).click();
    await expect(page.getByText('小狒在这里，这是第 1 段对话。',{exact:true})).toBeVisible();
    await expect(input).toHaveValue('还没发出的想法，等一下接着聊');
    await expect(page.getByLabel('待发送附件')).toContainText('随手笔记.txt');
  }
  expect(requests.filter(r=>r==='POST /conversations')).toHaveLength(1);
  await page.screenshot({path:info.outputPath('assistant-retained.png')});
});

test('刷新恢复选中的对话和文字草稿，账号切换不串对话',async({page},info)=>{
  const {input,setUser,requests}=await workspace(page);
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText('小狒在这里，这是第 1 段对话。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText('小狒在这里，这是第 2 段对话。',{exact:true})).toBeVisible();
  if(info.project.name==='mobile')await page.getByRole('button',{name:'更多对话操作',exact:true}).click();
  await page.locator(info.project.name==='mobile'?'.ai-mobile-menu:visible .el-select__wrapper':'.ai-conversation-tools .el-select__wrapper').click();
  await page.getByRole('option',{name:'对话 1',exact:true}).click();
  await expect(page.getByText('小狒在这里，这是第 1 段对话。',{exact:true})).toBeVisible();
  await input.fill('准备明天继续整理的文字');
  await page.reload();
  await expect(page.getByText('小狒在这里，这是第 1 段对话。',{exact:true})).toBeVisible();
  await expect(input).toHaveValue('准备明天继续整理的文字');
  setUser('retention-b');await page.reload();
  await expect(page.getByText('小狒在这里，这是第 1 段对话。',{exact:true})).toHaveCount(0);
  await expect(input).toHaveValue('');
  expect(requests.filter(r=>r==='POST /conversations')).toHaveLength(2);
});

test('失效的对话记录自动回到可用状态，仍能新建对话',async({page})=>{
  const {chats,input}=await workspace(page);
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await input.fill('旧对话草稿');
  chats.length=0;await page.reload();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.locator('.ai-page').getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText('小狒在这里，这是第 1 段对话。',{exact:true})).toBeVisible();
});
