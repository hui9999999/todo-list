import {test,expect,type Page} from '@playwright/test';

async function workspace(page:Page,initialTopics:string[]=['AI']) {
  page.setDefaultTimeout(10000);
  await page.addInitScript(()=>localStorage.setItem('todo-v2-web-pet-visible','0'));
  const settings:any={version:1,timezone:'Asia/Shanghai',memory_enabled:true,followups_enabled:true,work_start:'09:00',work_end:'18:00',recommendation_time:'09:00',daily_capacity:120,daily_call_limit:20,daily_token_limit:200000,weather_city:'北京',theme:'light',news_topics:initialTopics,news_enabled:true,suggestions_enabled:true,notifications_enabled:false,weather_enabled:false};
  const shared='本期关注人工智能模型与开发工具。';
  const base={state:'pending',bookmarked:false,proposal:null,published_at:'2026-10-09T08:00:00Z',source:'技术手册'};
  const items:any[]=[
    {...base,id:'ai-one',kind:'news',topic:'AI',title:'人工智能模型发布新版本',reason:'与当前明确兴趣或工作主题相关：AI\n了解新模型的能力和使用方式。\n本批资讯概览：'+shared,url:'https://example.com/ai'},
    {...base,id:'ai-two',kind:'news',topic:'AI',title:'AI 开发工具实践',reason:'与当前明确兴趣或工作主题相关：AI\n从实际项目了解开发工具。\n本批资讯概览：'+shared,url:'https://example.com/tools'},
    {...base,id:'city',kind:'news',topic:'生活',title:'城市公交更新',reason:'通用资讯 · 生活\n公共交通服务调整。',url:'https://example.com/city'},
    {...base,id:'advice',kind:'suggestions',title:'整理工作任务',reason:'今日工作建议',url:null},
  ];
  let fail=false,conflict=false;
  let status:any=null;
  const requests:{path:string;body:any}[]=[];
  await page.route('**/api/v1/**',route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:'news-user',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json=settings;
    if(path==='/recommendations/news-status')json=status;
    if(path==='/model-preferences')json=null;
    if(path==='/recommendations'){
      if(fail)return route.fulfill({status:503,json:{detail:'资讯暂时无法加载'}});
      json=items.filter(item=>(!settings.news_topics.length || settings.news_topics.includes(item.topic) || item.kind==='suggestions') && (settings.news_enabled || item.bookmarked));
    }
    if(req.method()==='POST'||req.method()==='PUT'){
      const body=req.postData()?req.postDataJSON():null;
      requests.push({path:path+url.search,body});
      if(path==='/settings'){Object.assign(settings,body,{version:settings.version+1});json=settings;}
      if(path==='/recommendations/refresh'){status={id:'news-job',state:'pending',message:''};json=status;}
      if(path==='/news-topics'){
        if(conflict){conflict=false;settings.version++;return route.fulfill({status:409,json:{detail:'关注设置已被另一页面修改，请刷新结果后重试'}});}
        if(body.version!==settings.version)return route.fulfill({status:409,json:{detail:'版本冲突'}});
        settings.news_topics=body.topics;settings.version++;json=settings;
      }
      const item=items.find(item=>path.includes('/'+item.id+'/'));
      if(path.endsWith('/feedback')&&item){
        if(body.action==='bookmark')item.bookmarked=!item.bookmarked;
        if(body.action==='skip'||body.action==='block_topic'||body.action==='block_source')item.state='dismissed';
      }
    }
    return route.fulfill({json});
  });
  return {settings,items,requests,shared,setFail(value:boolean){fail=value;},setConflict(){conflict=true;},setStatus(value:any){status=value;}};
}
const card=(page:Page,title:string)=>page.locator('.news-article').filter({has:page.getByRole('heading',{name:title,exact:true})});

async function addTopic(page:Page,topic:string){
  const input=page.getByRole('combobox',{name:'关注主题',exact:true});
  await input.fill(topic);
  await page.getByRole('option',{name:topic,exact:true}).click();
  await page.getByRole('heading',{name:'关注内容',exact:true}).click();
  await expect(page.getByRole('option',{name:topic,exact:true})).toBeHidden();
}

test('资讯只展示关注内容，概览去重，收藏与来源反馈保留',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const mock=await workspace(page);await page.goto('/news');
  await expect(page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('link',{name:'资讯',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.locator('.news-article')).toHaveCount(2);
  await expect(page.getByRole('heading',{name:'整理工作任务',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'生成今日建议',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'城市公交更新',exact:true})).toHaveCount(0);
  await expect(page.getByText(mock.shared,{exact:true})).toHaveCount(1);
  await page.getByText('本期概览',{exact:true}).click();
  await expect(page.getByText(mock.shared,{exact:true})).toBeVisible();
  const one=card(page,'人工智能模型发布新版本');
  await expect(one.getByRole('link',{name:'阅读原文 ↗',exact:true})).toHaveAttribute('href','https://example.com/ai');
  await one.getByRole('button',{name:'收藏',exact:true}).click();
  await page.getByRole('button',{name:'已收藏',exact:true}).first().click();
  await expect(page.locator('.news-article')).toHaveCount(1);
  await page.getByRole('button',{name:'推荐',exact:true}).click();
  await one.getByRole('button',{name:'更多操作：人工智能模型发布新版本',exact:true}).click();
  await page.getByRole('menuitem',{name:'屏蔽此来源',exact:true}).click();
  expect(mock.requests).toContainEqual({path:'/recommendations/ai-one/feedback',body:{action:'block_source'}});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('news.png'),fullPage:true,animations:'disabled'});
  expect(errors).toEqual([]);
});

test('选择 AI 后保存并刷新恢复，更新资讯只请求资讯任务',async({page})=>{
  const mock=await workspace(page,[]);await page.goto('/news');
  await addTopic(page,'AI');
  await page.getByRole('button',{name:'保存关注',exact:true}).click();
  await expect(page.locator('.news-article')).toHaveCount(2);
  expect(mock.settings.news_topics).toEqual(['AI']);
  await page.reload();
  await expect(page.getByRole('combobox',{name:'关注主题',exact:true})).toHaveCount(0);
  await expect(page.locator('.news-topic-list')).toHaveText('AI');
  await page.getByRole('button',{name:'更新资讯',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('正在检索并整理资讯');
  expect(mock.requests).toContainEqual({path:'/recommendations/refresh?kind=news',body:{}});
});

test('AI 整理自动完成并显示逐条摘要、重点与真实来源，刷新恢复',async({page})=>{
  const mock=await workspace(page,['医药相关']);await page.goto('/news');
  await expect(page.getByRole('heading',{name:'暂无相关资讯',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'更新资讯',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('完成后将自动显示');
  await expect(page.getByRole('heading',{name:'暂无相关资讯',exact:true})).toHaveCount(0);
  mock.items.push({id:'medical',kind:'news',topic:'医药相关',title:'新药临床研究进展',reason:'',ai_curated:true,
    summary:'公开研究报告了临床试验结果，结论限于研究范围。',points:['以原始研究中的适应症为准。'],
    sources:[{title:'临床研究原始报告',url:'https://example.com/research',site:'研究机构',published_at:null},{title:'监管公告',url:'https://other.example/approval',site:'药监机构',published_at:'2026-10-09T00:00:00Z'}],
    url:'https://example.com/research',source:'研究机构',state:'pending',bookmarked:false,published_at:null});
  mock.setStatus({id:'news-job',state:'completed',count:1,message:'AI 已整理 1 条资讯，每条附原始来源。'});
  await expect(page.locator('.news-article')).toHaveCount(1,{timeout:8000});
  await expect(page.getByRole('status')).toContainText('AI 已整理 1 条资讯');
  await expect(page.locator('.news-points')).toContainText('以原始研究中的适应症为准');
  const sources=page.getByRole('list',{name:'资讯来源'});
  await expect(sources.getByRole('link')).toHaveCount(2);
  await expect(sources.getByRole('link').first()).toHaveAttribute('href','https://example.com/research');
  await expect(sources).toContainText('发布日期未提供');
  await page.reload();await expect(sources.getByRole('link')).toHaveCount(2);
  expect(mock.requests.filter(r=>r.path==='/recommendations/refresh?kind=news')).toHaveLength(1);
});

test('后台失败显示原因，重新进入恢复进行中的整理',async({page})=>{
  const mock=await workspace(page,['医药相关']);
  mock.setStatus({id:'news-job',state:'running',message:''});await page.goto('/news');
  await expect(page.getByRole('status')).toContainText('正在检索并整理资讯');
  mock.setStatus({id:'news-job',state:'failed',message:'请先在 AI 设置中连接模型，再更新资讯'});
  await expect(page.getByRole('alert')).toContainText('请先在 AI 设置中连接模型',{timeout:8000});
  await expect(page.getByRole('button',{name:'更新资讯',exact:true})).toBeEnabled();
  expect(mock.requests.filter(r=>r.path==='/recommendations/refresh?kind=news')).toHaveLength(0);
});

test('检索来源不足不显示为没有资讯',async({page})=>{
  const mock=await workspace(page,['DeepSeek']);
  mock.setStatus({id:'news-job',state:'completed',count:0,outcome:'insufficient_sources',
    message:'本次检索未取得足够的相关报道，暂时无法判断是否有新资讯。请稍后重试。'});
  await page.goto('/news');
  await expect(page.getByRole('heading',{name:'暂未取得相关报道',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'暂无相关资讯',exact:true})).toHaveCount(0);
  await expect(page.locator('.news-empty')).toContainText('不代表没有相关资讯');
  await expect(page.getByRole('status')).toContainText('无法判断');
  await page.reload();
  await expect(page.getByRole('heading',{name:'暂未取得相关报道',exact:true})).toBeVisible();
});

test('自定义主题和并发冲突保留草稿，刷新后可重新保存',async({page})=>{
  const mock=await workspace(page);await page.goto('/news');
  await page.getByRole('button',{name:'编辑关注',exact:true}).click();
  await addTopic(page,'机器人');mock.setConflict();
  await page.getByRole('button',{name:'保存关注',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('关注设置已被另一页面修改');
  await expect(page.locator('.news-topic-editor')).toContainText('机器人');
  await page.getByRole('button',{name:'刷新结果重试',exact:true}).click();
  await expect(page.locator('.news-topic-editor')).toContainText('机器人');
  await page.getByRole('button',{name:'保存关注',exact:true}).click();
  expect(mock.settings.news_topics).toEqual(['AI','机器人']);
  await expect(page.locator('.news-topic-editor')).toHaveCount(0);
});

test('没有相关内容时保留严格主题，关闭和加载失败可恢复',async({page},info)=>{
  const mock=await workspace(page,['机器人']);await page.goto('/news');
  await expect(page.getByRole('heading',{name:'暂无相关资讯',exact:true})).toBeVisible();
  await expect(page.locator('.news-article')).toHaveCount(0);
  mock.settings.news_enabled=false;await page.reload();
  await expect(page.getByRole('link',{name:'前往偏好设置 →',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'更新资讯',exact:true})).toHaveCount(0);
  mock.setFail(true);await page.reload();
  await expect(page.getByRole('alert')).toContainText('资讯暂时无法加载');
  mock.setFail(false);mock.settings.news_enabled=true;
  await page.getByRole('button',{name:'刷新结果重试',exact:true}).click();
  await expect(page.getByRole('heading',{name:'暂无相关资讯',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('news-empty.png'),fullPage:true,animations:'disabled'});
});

test('偏好设置保存其他选项时保留资讯关注主题',async({page})=>{
  const mock=await workspace(page);await page.goto('/account');
  await page.getByRole('spinbutton',{name:'每日容量',exact:true}).fill('135');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.getByText('设置已保存',{exact:true})).toBeVisible();
  expect(mock.requests.find(r=>r.path==='/settings')!.body.news_topics).toEqual(['AI']);
  await page.goto('/news');
  await expect(page.locator('.news-topic-list')).toHaveText('AI');
});
