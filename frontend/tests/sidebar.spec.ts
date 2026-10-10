import {test, expect, type Page} from '@playwright/test';

async function mockWorkspace(page: Page) {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path.endsWith('/me')) json = {user:{id:'sidebar-user',email:'sidebar@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if (path.endsWith('/settings')) json = {theme:'light',notifications_enabled:false,weather_enabled:false};
    if (path.endsWith('/model-preferences')) json = {model:'test-model'};
    return route.fulfill({json});
  });
}

test('收起导航释放空间，键盘可恢复，刷新和换页记住选择', async ({page}, info) => {
  const errors:string[]=[]; page.on('pageerror', error => errors.push(error.message));
  await mockWorkspace(page);
  await page.goto('/tasks');
  const sidebar = page.locator('#workspace-sidebar');
  const hide = page.getByRole('button',{name:'收起侧边栏',exact:true});
  const show = page.getByRole('button',{name:'展开侧边栏',exact:true});
  await expect(sidebar).toBeVisible();
  const before = await page.locator('.workspace-main').boundingBox();
  await hide.focus(); await page.keyboard.press('Enter');
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole('navigation',{name:'工作区',exact:true})).toBeHidden();
  await expect(show).toBeFocused();
  await expect(show).toHaveAttribute('aria-expanded','false');
  const after = await page.locator('.workspace-main').boundingBox();
  if (info.project.name === 'desktop') expect(after!.width).toBeGreaterThan(before!.width);
  else expect(after!.y).toBeLessThan(before!.y);
  await page.reload();
  await expect(sidebar).toBeHidden();
  await expect(show).toBeVisible();
  await page.goto('/today');
  await expect(sidebar).toBeHidden();
  await show.click();
  await expect(sidebar).toBeVisible();
  await expect(hide).toBeFocused();
  await sidebar.getByRole('link',{name:/^清单/}).click();
  await expect(page.getByRole('heading',{name:'今日清单',exact:true})).toBeVisible();
  await hide.click();
  const toggle = await show.boundingBox(), heading = await page.getByRole('heading',{name:'今日清单',exact:true}).boundingBox();
  expect(toggle!.y + toggle!.height).toBeLessThan(heading!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('sidebar-hidden.png'),fullPage:true});
  await show.click(); await page.reload();
  await expect(sidebar).toBeVisible();
  await page.screenshot({path:info.outputPath('sidebar-expanded.png'),fullPage:true});
  expect(errors).toEqual([]);
});

test('助手页面收起后输入区完整可见，窄屏和存储不可用时也能切换', async ({page}, info) => {
  await mockWorkspace(page);
  if(info.project.name === 'mobile') await page.setViewportSize({width:320,height:850});
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {if(key === 'todo-v2-sidebar-hidden') throw new Error('Storage unavailable'); return get.call(this,key);};
    Storage.prototype.setItem = function(key,value) {if(key === 'todo-v2-sidebar-hidden') throw new Error('Storage unavailable'); return set.call(this,key,value);};
  });
  await page.goto('/ai');
  const hide = page.getByRole('button',{name:'收起侧边栏',exact:true});
  const show = page.getByRole('button',{name:'展开侧边栏',exact:true});
  await hide.click();
  await expect(page.locator('#workspace-sidebar')).toBeHidden();
  await expect(page.locator('.ai-header')).toBeVisible();
  await expect(page.locator('.ai-composer textarea')).toBeVisible();
  const toggle = await show.boundingBox(), identity = await page.locator('.ai-identity').boundingBox();
  expect(toggle!.x + toggle!.width).toBeLessThan(identity!.x);
  const composer = await page.locator('.ai-composer').boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('sidebar-ai-hidden.png'),fullPage:true});
  await show.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-sidebar')).toBeVisible();
  await expect(hide).toBeFocused();
});

test('手机切换 AI 助手时工作台标题与顶部导航保持原位', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile', '检查手机顶部导航');
  await mockWorkspace(page);
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await page.goto('/tasks');
    const brand=page.getByRole('button',{name:'个人工作台，切换主题',exact:true});
    await expect(brand).toBeVisible();
    const before=await brand.boundingBox();
    const accountBefore=await page.locator('.mobile-account').boundingBox();
    const toggleBefore=await page.getByRole('button',{name:'收起侧边栏',exact:true}).boundingBox();
    await page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('link',{name:'AI 助手',exact:true}).click();
    await expect(page.locator('.ai-composer textarea')).toBeVisible();
    const after=await brand.boundingBox();
    expect(after!.y,`宽度 ${width} 时标题的垂直位置`).toBeCloseTo(before!.y,1);
    expect(after!.height).toBeCloseTo(before!.height,1);
    expect((await page.locator('.mobile-account').boundingBox())!.y).toBeCloseTo(accountBefore!.y,1);
    expect((await page.getByRole('button',{name:'收起侧边栏',exact:true}).boundingBox())!.y).toBeCloseTo(toggleBefore!.y,1);
    await page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('link',{name:/^清单/}).click();
    await expect(page.getByRole('heading',{name:'今日清单',exact:true})).toBeVisible();
    expect((await brand.boundingBox())!.y).toBeCloseTo(before!.y,1);
  }
});
