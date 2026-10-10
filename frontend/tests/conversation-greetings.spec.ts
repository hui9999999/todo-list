import {test,expect} from '@playwright/test';

test('每个新对话显示自己的开场白，切换保留原句且快捷建议仍可用',async({page},info)=>{
  const greetings=['小狒报到 🐒 今天想先搞定哪件小事？','新的一页，咱们慢慢聊。先说一个想法也行，不用一次想得很完整。'];
  const chats:any[]=[],calls:string[]=[];let configured=false;
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');let json:any=[];
    calls.push(request.method()+' '+path);
    if(path==='/me')json={user:{id:'greetings',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'light',weather_enabled:false};
    if(path==='/model-preferences')json=configured?{model:'test'}:null;
    if(path==='/conversations'){
      if(request.method()==='POST')chats.push({id:'chat-'+chats.length,title:'对话 '+(chats.length+1)});
      json=request.method()==='POST'?chats.at(-1):[...chats].reverse();
    }
    if(/\/conversations\/chat-\d\/messages/.test(path)){
      const index=Number(path.match(/chat-(\d)/)![1]);
      json={messages:[{id:'greeting-'+index,role:'assistant',content:greetings[index]}],runs:[]};
    }
    await route.fulfill({json});
  });
  await page.goto('/ai');
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText(greetings[0],{exact:true})).toHaveCount(1);
  await expect(page.getByText(greetings[0],{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'连接对话模型 →',exact:true})).toBeVisible();
  await page.getByRole('group',{name:'对话建议',exact:true}).filter({visible:true}).getByRole('button',{name:'安排今天',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'发给 AI 的消息',exact:true})).toHaveValue('帮我安排今天的事情');
  configured=true;
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(page.getByText(greetings[1],{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'连接对话模型 →',exact:true})).toHaveCount(0);
  await expect(page.getByText(greetings[0],{exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('conversation-opening.png')});
  if(info.project.name==='mobile')await page.getByRole('button',{name:'更多对话操作',exact:true}).click();
  await page.locator(info.project.name==='mobile'?'.ai-mobile-menu:visible .el-select__wrapper':'.ai-conversation-tools .el-select__wrapper').click();
  await page.getByRole('option',{name:'对话 1',exact:true}).click();
  await expect(page.getByText(greetings[0],{exact:true})).toBeVisible();
  await expect(page.getByText(greetings[1],{exact:true})).toHaveCount(0);
  expect(calls.filter(call=>call.startsWith('POST /conversations'))).toEqual(['POST /conversations','POST /conversations']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
