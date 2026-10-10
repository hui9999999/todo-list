import {test,expect} from '@playwright/test';

test('历史与记忆优先展示内容，新增收起且固定保存仍可用',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const memories:any[]=[
    {id:'goal',content:'准备面试时，先理解知识点，再合上笔记尝试复述。每天留出时间复盘没有答好的问题。',key:'面试准备',kind:'goal',scope:'study',pinned:true,effective_state:'active',effective_strength:1,source_kind:'explicit',version:1},
    {id:'interest',content:'关注科技进展，也喜欢了解城市生活与文化展览。',key:'阅读兴趣',kind:'interest',scope:'all',pinned:false,effective_state:'fading',effective_strength:.4,source_kind:'confirmed',version:1},
  ];
  const writes:any[]=[];
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:'memory-layout',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'light',weather_enabled:false};
    if(path==='/auth/desktop-link/presence')json={desktop_active:true};
    if(path==='/history/search')json={hits:[{event_id:'event',task_id:'task',title:'完成本周项目复盘并记录下一步行动',completed:true,occurred_at:'2026-10-08T01:00:00Z',snapshot:{notes:'核对交付进度与待解决的问题。'},reason:'匹配任务标题'}],message:'按关键词查找历史'};
    if(path==='/memories'){
      if(req.method()==='POST'){writes.push(req.postDataJSON());memories.push({...req.postDataJSON(),id:'new',effective_state:'active',effective_strength:1,source_kind:'explicit',version:1});}
      json=memories;
    }
    if(path==='/memories/goal/pin'){memories[0].pinned=!memories[0].pinned;json=memories[0];}
    await route.fulfill({json});
  });
  await page.goto('/ai?tab=history');
  await page.getByRole('button',{name:'记忆',exact:true}).click();
  await expect(page.locator('.memory-record')).toHaveCount(2);
  await expect(page.getByRole('textbox',{name:'记忆内容',exact:true})).toBeHidden();
  await expect(page.locator('.memory-record').first()).toContainText(memories[0].content);
  await page.locator('.memory-record').first().getByRole('button',{name:'取消固定',exact:true}).click();
  await expect(page.locator('.memory-record').first().getByRole('button',{name:'固定',exact:true})).toBeVisible();
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('memory-history.png'),fullPage:true});
  await page.getByRole('button',{name:'新增记忆',exact:true}).click();
  await page.getByRole('textbox',{name:'记忆关键词',exact:true}).fill('面试准备');
  await page.getByRole('textbox',{name:'记忆内容',exact:true}).fill('每天早上读十分钟');
  await page.getByRole('button',{name:'保存记忆',exact:true}).click();
  await expect(page.locator('.memory-record')).toHaveCount(3);
  await expect(page.getByRole('textbox',{name:'记忆内容',exact:true})).toBeHidden();
  await expect(page.getByRole('textbox',{name:'记忆关键词',exact:true})).toHaveValue('');
  expect(writes[0]).toMatchObject({content:'每天早上读十分钟',kind:'preference',scope:'all'});
  expect(errors).toEqual([]);
});

test('历史与记忆分区保留筛选和草稿，记忆状态筛选及确认遗忘可用',async({page})=>{
  page.setDefaultTimeout(10000);
  let memories:any[]=[
    {id:'active',content:'每天预留复盘时间',key:'复盘节奏',kind:'preference',scope:'all',effective_state:'active',version:1,pinned:false,effective_strength:1,source_kind:'explicit'},
    {id:'candidate',content:'关注城市展览',key:'文化兴趣',kind:'interest',scope:'life',effective_state:'candidate',version:3,pinned:false,effective_strength:.4,source_kind:'inferred'},
    {id:'expired',content:'交付前减少会议',key:'交付约束',kind:'constraint',scope:'work',effective_state:'expired',version:1,pinned:false,effective_strength:0,source_kind:'explicit'},
  ];
  const searches:URLSearchParams[]=[],writes:any[]=[];
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:'history-filters',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'light',weather_enabled:false};
    if(path==='/auth/desktop-link/presence')json={desktop_active:true};
    if(path==='/history/search'){searches.push(url.searchParams);json={hits:[],message:'按关键词查找历史'};}
    if(path==='/memories')json=memories;
    if(path==='/memories/candidate/pin'){writes.push(req.postDataJSON());memories[1].effective_state='active';memories[1].pinned=true;json=memories[1];}
    if(path==='/memories/candidate/forget'){writes.push({forget:true});memories=memories.filter(m=>m.id!=='candidate');json={};}
    await route.fulfill({json});
  });
  await page.goto('/ai?tab=history');
  await page.getByRole('textbox',{name:'历史关键词',exact:true}).fill('项目复盘');
  await page.getByText('筛选时间',{exact:true}).click();
  await page.getByLabel('历史开始时间',{exact:true}).fill('2026-10-01T09:00');
  await page.getByLabel('历史结束时间',{exact:true}).fill('2026-10-09T18:00');
  await page.getByText('按意思查找相似记录',{exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'按意思查找相似记录',exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'查找历史',exact:true}).click();
  await expect.poll(()=>searches.at(-1)?.get('q')).toBe('项目复盘');
  expect(searches.at(-1)?.get('semantic')).toBe('false');
  expect(searches.at(-1)?.get('start')).toBe(new Date('2026-10-01T09:00').toISOString());
  expect(searches.at(-1)?.get('end')).toBe(new Date('2026-10-09T18:00').toISOString());
  const memoryButton=page.getByRole('button',{name:'记忆',exact:true});
  await memoryButton.click();
  await expect(memoryButton).toHaveAttribute('aria-pressed','true');
  await page.getByRole('textbox',{name:'记忆关键词',exact:true}).fill('复盘节奏');
  await expect(page.locator('.memory-record:visible')).toHaveCount(1);
  await expect(page.locator('.memory-record:visible')).toContainText('每天预留复盘时间');
  await page.getByRole('textbox',{name:'记忆关键词',exact:true}).fill('');
  await page.getByRole('combobox',{name:'记忆状态',exact:true}).focus();
  await page.getByRole('combobox',{name:'记忆状态',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'待确认',exact:true}).click();
  await expect(page.locator('.memory-record:visible')).toHaveCount(1);
  await page.getByRole('button',{name:'确认候选',exact:true}).click();
  await expect(page.getByText('没有匹配的记忆，试试其他关键词或状态。',{exact:true})).toBeVisible();
  expect(writes[0]).toEqual({version:3});
  await page.getByRole('combobox',{name:'记忆状态',exact:true}).focus();
  await page.getByRole('combobox',{name:'记忆状态',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'暂不使用',exact:true}).click();
  await expect(page.locator('.memory-record:visible')).toContainText('交付前减少会议');
  await expect(page.getByRole('button',{name:'固定',exact:true})).toBeDisabled();
  await page.getByRole('combobox',{name:'记忆状态',exact:true}).focus();
  await page.getByRole('combobox',{name:'记忆状态',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'全部状态',exact:true}).click();
  await page.getByRole('button',{name:'新增记忆',exact:true}).click();
  await page.getByRole('textbox',{name:'记忆内容',exact:true}).fill('尚未保存的记忆');
  await page.getByRole('button',{name:'任务历史',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'历史关键词',exact:true})).toHaveValue('项目复盘');
  await expect(page.getByLabel('历史开始时间',{exact:true})).toHaveValue('2026-10-01T09:00');
  await memoryButton.click();
  await expect(page.getByRole('textbox',{name:'记忆内容',exact:true})).toHaveValue('尚未保存的记忆');
  const candidate=page.locator('.memory-record').filter({hasText:'关注城市展览'});
  await candidate.getByRole('button',{name:'忘掉这条',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  expect(writes).toHaveLength(1);
  await candidate.getByRole('button',{name:'忘掉这条',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确定',exact:true}).click();
  await expect(candidate).toHaveCount(0);
  expect(writes.at(-1)).toEqual({forget:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('通用资讯单独标识且仍能屏蔽主题',async({page})=>{
  const writes:any[]=[];
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:'general-news',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'light',news_enabled:true};
    if(path==='/recommendations')json=[{id:'news',kind:'news',topic:'通用资讯·科技',title:'最新科技进展',reason:'通用资讯 · 科技',source:'科技来源',url:'https://example.com/news',state:'pending',proposal:null}];
    if(path==='/recommendations/news/feedback'){writes.push(req.postDataJSON());json={};}
    await route.fulfill({json});
  });
  await page.goto('/news');
  await expect(page.locator('.recommendation-card .eyebrow')).toHaveText('通用资讯 · 待查看');
  await page.getByRole('button',{name:'更多操作：最新科技进展',exact:true}).click();
  await page.getByRole('menuitem',{name:'屏蔽此主题',exact:true}).click();
  expect(writes).toEqual([{action:'block_topic'}]);
});
