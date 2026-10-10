import {test, expect} from '@playwright/test';

test('账户入口无副标题，历史与记忆归入账户，切换保留草稿和历史来源', async ({page}, info) => {
  const errors: string[]=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/api/v1/me', route=>route.fulfill({json:{user:{id:'navigation-user',email:'navigation@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'}}));
  await page.route('**/api/v1/settings', route=>route.fulfill({json:{theme:'light'}}));
  for (const path of ['tasks','projects','daily-plans','provider-connections','jobs']) await page.route(`**/api/v1/${path}*`, route=>route.fulfill({json:[]}));
  await page.route('**/api/v1/conversations', route=>route.fulfill({json:[{id:'navigation-chat',title:'之前的对话'}]}));
  await page.route('**/api/v1/conversations/navigation-chat/messages', route=>route.fulfill({json:{messages:[],runs:[]}}));
  await page.route('**/api/v1/model-preferences', route=>route.fulfill({json:{model:'test'}}));
  await page.route('**/api/v1/auth/desktop-link/presence',route=>route.fulfill({json:{desktop_active:true}}));
  await page.route('**/api/v1/history/search*', route=>route.fulfill({json:{hits:[],message:'',mode:'keyword',index_status:'ready'}}));
  await page.route('**/api/v1/memories', route=>route.fulfill({json:[{id:'memory',content:'下午集中处理工作',scope:'work',kind:'preference',effective_state:'active',effective_strength:1,source_kind:'explicit',pinned:true,version:1}]}));
  await page.route('**/api/v1/tasks/source-task/events', route=>route.fulfill({json:[{id:'event',kind:'created',occurred_at:'2026-10-01T01:00:00Z',after:{title:'原任务记录',notes:'原始备注',status:'todo'}}]}));
  await page.goto('/ai');
  const nav=page.getByRole('navigation',{name:'工作区',exact:true});
  await expect(nav.getByRole('link',{name:'历史与记忆',exact:true})).toHaveCount(0);
  await expect(page.locator('.account-link p')).toHaveCount(0);
  const input=page.getByRole('textbox',{name:'发给 AI 的消息',exact:true});
  await input.fill('稍后继续写的草稿');
  if(info.project.name==='desktop') {
    await expect(page.locator('.ai-composer-starters')).toBeHidden();
    await expect(page.locator('.ai-welcome .ai-starters')).toBeVisible();
  }
  if(info.project.name==='mobile') {
    const transcript=await page.locator('.ai-chat-scroll').boundingBox();
    expect(transcript!.height).toBeGreaterThan(844 * 0.45);
    const starters=page.getByRole('group',{name:'对话建议',exact:true});
    await expect(starters.getByRole('button')).toHaveCount(3);
    const suggestions=await starters.boundingBox(),composer=await page.locator('.chat-input').boundingBox();
    expect(suggestions!.y).toBeGreaterThan(transcript!.y+transcript!.height-1);
    expect(composer!.y-suggestions!.y-suggestions!.height).toBeGreaterThanOrEqual(0);
    expect(composer!.y-suggestions!.y-suggestions!.height).toBeLessThanOrEqual(12);
    await expect(page.locator('.ai-welcome .ai-starters')).toBeHidden();
    await page.screenshot({path:info.outputPath('assistant-starters-bottom.png')});
    await expect(page.getByText('Enter 发送 · Shift + Enter 换行',{exact:true})).toBeHidden();
    await page.getByRole('button',{name:'任务快捷操作',exact:true}).click();
    await page.getByRole('button',{name:'创建任务',exact:true}).click();
    await expect(input).toHaveValue('创建任务：任务名称');
    await input.fill('稍后继续写的草稿');
    await page.getByRole('button',{name:'任务快捷操作',exact:true}).click();
    await page.getByRole('button',{name:'使用说明',exact:true}).click();
    const help=page.getByRole('dialog',{name:'使用说明',exact:true});
    await expect(help.getByText('支持 Word（DOCX）、PDF、MD、JSON、TXT、CSV、图片，也可以拖入文件和粘贴截图。',{exact:true})).toBeVisible();
    await help.getByRole('button',{name:'关闭此对话框',exact:true}).click();
    for(const viewport of [{width:320,height:568},{width:390,height:500}]) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport();
      await expect(page.getByRole('button',{name:'查找类似事项',exact:true})).toBeInViewport();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect((await page.locator('.ai-chat-scroll').boundingBox())!.height).toBeGreaterThan(100);
    }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'安排今天',exact:true}).click();
    await expect(input).toHaveValue('帮我安排今天的事情');
    await input.fill('稍后继续写的草稿');
    await page.getByRole('button',{name:'更多对话操作',exact:true}).click();
    await page.locator('.ai-mobile-menu:visible .el-select__wrapper').click();
    await page.getByRole('option',{name:'之前的对话',exact:true}).click();
    await expect(page.getByRole('button',{name:'更多对话操作',exact:true})).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('.ai-mobile-menu:visible')).toHaveCount(0);
    await expect(input).toHaveValue('稍后继续写的草稿');
    await page.screenshot({path:info.outputPath('assistant-mobile-compact.png')});
    await page.getByRole('button',{name:'更多对话操作',exact:true}).click();
    await expect(page.getByRole('button',{name:'删除对话',exact:true})).toBeVisible();
  }
  await expect(page.locator('.ai-header').getByRole('link',{name:'历史与记忆',exact:true})).toHaveCount(0);
  if(info.project.name==='mobile')await page.getByRole('button',{name:'更多对话操作',exact:true}).click();
  await page.locator('.sidebar:visible').getByRole('link',{name:'个人账户',exact:true}).click();
  await page.getByRole('navigation',{name:'账户设置分区'}).getByRole('link',{name:'历史与记忆',exact:true}).click();
  await expect(page.getByRole('heading',{name:'历史与记忆',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'记忆',exact:true}).click();
  await expect(page.getByText('下午集中处理工作',{exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'账户设置分区'}).getByRole('link',{name:'历史与记忆',exact:true})).toHaveAttribute('aria-current','page');
  await page.screenshot({path:info.outputPath('assistant-history.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await nav.getByRole('link',{name:'AI 助手',exact:true}).click();
  await expect(input).toHaveValue('稍后继续写的草稿');
  await page.screenshot({path:info.outputPath('assistant-navigation.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto('/history?task=source-task');
  await expect(page.getByText('原任务记录',{exact:true})).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/account');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('history');
  expect(new URL(page.url()).searchParams.get('task')).toBe('source-task');
  expect(errors).toEqual([]);
});
