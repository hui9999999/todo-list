import {test,expect} from '@playwright/test';

test('联网开关、搜索状态与来源在切页和刷新后恢复',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let sent=false,finish=false,account='search-user';
  const requests:any[]=[];
  const source={index:1,title:'Python 官方文档',url:'https://docs.python.org/3/',site:'docs.python.org',snippet:'官方文档',published_at:null};
  const run=()=>({id:'search-run',status:finish?'completed':'running',answer:finish?'请看官方文档。[网页1]':'',proposals:[],web_search:{state:finish?'completed':'searching'},created_at:new Date().toISOString()});
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:account,timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'warm',weather_enabled:false,notifications_enabled:false};
    if(path==='/model-preferences')json={model:'test'};
    if(path==='/conversations')json=[{id:'chat',title:'联网查询'}];
    if(path==='/conversations/chat/messages'){
      if(request.method()==='POST'){sent=true;requests.push(request.postDataJSON());json=run();}
      else json={messages:sent?[{id:'user',role:'user',content:'搜索 Python 官方文档'},...(finish?[{id:'answer',role:'assistant',content:run().answer}]:[])]:[],runs:sent?[run()]:[],web_sources:finish?[{message_id:'answer',sources:[source,{...source,index:2,url:'javascript:alert(1)',title:'危险链接'}]}]:[]};
    }
    if(path==='/agent-runs/search-run')json=run();
    if(path==='/agent-runs/search-run/events')return route.fulfill({contentType:'text/event-stream',body:'id: 1\nevent: web_search\ndata: {"state":"searching"}\n\n'});
    await route.fulfill({json});
  });
  await page.goto('/ai');
  const toggle=page.getByRole('button',{name:'联网搜索',exact:true});
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
  await page.getByRole('textbox',{name:'发给 AI 的消息',exact:true}).fill('搜索 Python 官方文档');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'正在联网搜索'})).toBeVisible();
  expect(requests[0].web_search_enabled).toBe(true);
  await expect(toggle).toBeDisabled();
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:568});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const send=await page.getByRole('button',{name:'发送',exact:true}).boundingBox();expect(send!.x+send!.width).toBeLessThanOrEqual(info.project.name==='mobile'?320:1440);
  await page.reload();await expect(page.getByRole('status').filter({hasText:'正在联网搜索'})).toBeVisible();
  finish=true;
  await expect(page.getByRole('region',{name:'网页来源',exact:true})).toBeVisible({timeout:15000});
  const link=page.getByRole('link',{name:'Python 官方文档 docs.python.org'});
  await expect(link).toHaveAttribute('href',source.url);await expect(link).toHaveAttribute('rel','noopener noreferrer');
  await expect(page.getByRole('link',{name:/危险链接/})).toHaveCount(0);
  const nav=page.getByRole('navigation',{name:'工作区',exact:true});
  await nav.getByRole('link',{name:'日历',exact:true}).click();await nav.getByRole('link',{name:'AI 助手',exact:true}).click();
  await expect(link).toBeVisible();await page.reload();await expect(link).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');
  await page.reload();await expect(toggle).toHaveAttribute('aria-pressed','false');
  account='different-user';await page.reload();await expect(toggle).toHaveAttribute('aria-pressed','false');
  expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('web-search-sources.png')});
});

test('天气实况来源不标为搜索摘要，刷新后可继续打开',async({page})=>{
  const source={index:1,kind:'weather',title:'深圳天气实况',url:'https://www.weather.com.cn/weather1d/101280601.shtml',site:'中国天气网',snippet:'多云',published_at:null};
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:'weather-source-user',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'warm',weather_enabled:false,notifications_enabled:false};
    if(path==='/model-preferences')json={model:'test'};
    if(path==='/conversations')json=[{id:'chat',title:'天气'}];
    if(path==='/conversations/chat/messages')json={messages:[{id:'u',role:'user',content:'今天天气怎么样'},{id:'a',role:'assistant',content:'深圳当前多云，28.5°C，14:30更新。[网页1]'}],runs:[],web_sources:[{message_id:'a',sources:[source]}]};
    await route.fulfill({json});
  });
  await page.goto('/ai');
  const region=page.getByRole('region',{name:'天气来源',exact:true});
  await expect(region).toContainText('天气来源 · 当前实况');
  await expect(page.getByText('网页来源 · 基于搜索摘要', {exact:true})).toHaveCount(0);
  await expect(region.getByRole('link')).toHaveAttribute('href',source.url);
  await page.reload();await expect(region).toBeVisible();
});
