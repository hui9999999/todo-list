import {test,expect,type Page} from '@playwright/test';
import {foods,foodGroups,retiredFoods,choiceKey,choiceContent,readChoices} from '../src/food-catalog';

test.use({timezoneId:'UTC'});
async function workspace(page:Page){
  await page.clock.install({time:new Date('2026-10-04T20:30:00Z')});
  let user={id:'food-a',timezone:'Asia/Shanghai'}, failRead=false, failSave=false, holdSave=false;
  let release=()=>{};
  const data:Record<string,any[]>={'food-a':[],'food-b':[]};
  const writes:{user:string;body:any;csrf:string|undefined}[]=[];
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');
    let json:any=[];
    if(path==='/me')json={user,csrf_token:'food-csrf'};
    if(path==='/settings')json={version:1,theme:'warm',weather_enabled:false,notifications_enabled:false};
    if(path==='/auth/desktop-link/presence')json={desktop_active:true};
    if(path==='/memories'){
      if(request.method()==='POST'){
        const owner=user.id,body=request.postDataJSON();writes.push({user:owner,body,csrf:request.headers()['x-csrf-token']});
        if(holdSave)await new Promise<void>(resolve=>{release=resolve;});
        if(failSave)return route.fulfill({status:503,json:{detail:'记忆暂时无法保存'}});
        for(const old of data[owner])if(old.key===body.key)old.effective_state='superseded';
        json={...body,id:'memory-'+writes.length,version:1,effective_state:'active',effective_strength:1,source_kind:'explicit'};
        data[owner].unshift(json);
      }else{
        if(failRead)return route.fulfill({status:503,json:{detail:'记忆暂时无法读取'}});
        json=data[user.id];
      }
    }
    return route.fulfill({json});
  });
  await page.goto('/food');
  await expect(page.getByRole('heading',{name:/^(把吃饭这件小事，交给一点惊喜|今日三餐)$/})).toBeVisible();
  await expect(page.getByRole('button',{name:'重新抽取三餐',exact:true})).toBeEnabled();
  return {writes,data,readFailure:(value:boolean)=>{failRead=value;},saveFailure:(value:boolean)=>{failSave=value;},hold:()=>{holdSave=true;},release:()=>{holdSave=false;release();},switchUser:async()=>{
    user={id:'food-b',timezone:'America/Los_Angeles'};
    await page.evaluate(async current=>{const path='/src/stores/auth.ts';(await import(path)).useAuth().user=current;},user);
  }};
}
const card=(page:Page,name:string)=>page.getByRole('article',{name:name+'选择',exact:true});
const dish=(page:Page,name:string)=>page.locator('.food-gallery').getByRole('article',{name,exact:true});
const menu=(page:Page,name:string)=>page.getByRole('article',{name:name+'菜单',exact:true});

test('手机首屏完整显示三餐，紧凑卡片保留换菜、轮播和加入菜单',async({page},info)=>{
  test.skip(info.project.name!=='mobile','手机三餐布局');
  const state=await workspace(page);
  for(const name of ['早餐','午餐','晚餐']){
    const meal=card(page,name);
    await expect(meal).toBeInViewport({ratio:1});
    expect((await meal.boundingBox())!.height).toBeLessThan(170);
    const image=meal.locator('.carousel-current');
    await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    for(const label of ['换一个','加入菜单']){
      const button=meal.getByRole('button',{name:label,exact:true});
      await expect(button).toBeVisible();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.screenshot({path:info.outputPath('food-three-meals-mobile.png'),animations:'disabled'});
  await page.setViewportSize({width:320,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const name of ['早餐','午餐','晚餐'])await expect(card(page,name)).toBeInViewport({ratio:1});
  await page.screenshot({path:info.outputPath('food-three-meals-narrow.png'),animations:'disabled'});
  for(const name of ['早餐','午餐','晚餐']){
    const meal=card(page,name),before=await meal.locator('.carousel-current').getAttribute('alt');
    await meal.getByRole('button',{name:name+'下一道',exact:true}).click();
    await expect(meal.locator('.carousel-current')).not.toHaveAttribute('alt',before!);
    await meal.getByRole('button',{name:'加入菜单',exact:true}).click();
    await expect(meal.getByRole('button',{name:'已在菜单',exact:true})).toBeDisabled();
  }
  expect(state.writes).toHaveLength(3);
  await page.reload();
  for(const name of ['早餐','午餐','晚餐'])await expect(card(page,name).getByRole('button',{name:'已在菜单',exact:true})).toBeDisabled();
});

test('汤类扩充且清蒸鱼去重，含旧菜的菜单可以继续添加和移除',async({page},info)=>{
  const state=await workspace(page),retired=retiredFoods.find(food=>food.id==='steamed-fish')!,pork=foods.find(food=>food.id==='pepper-cured-pork')!;
  state.data['food-a'].push({id:'legacy-fish',key:choiceKey('2026-10-05','lunch'),content:choiceContent('2026-10-05','lunch',[pork,retired]),scope:'life',kind:'interest',effective_state:'active'});
  await page.reload();
  await expect(menu(page,'午餐').locator('.menu-dish')).toHaveCount(2);
  await expect(menu(page,'午餐')).toContainText('清蒸鱼');
  await expect(card(page,'午餐').locator('.carousel-current')).toHaveAttribute('alt','辣椒炒腊肉');
  await expect(page.locator('.food-library').getByRole('heading',{name:'清蒸鱼',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'鱼虾',exact:true}).click();
  await expect(page.locator('.food-gallery article')).toHaveCount(9);
  await expect(dish(page,'清蒸鲈鱼')).toBeVisible();
  await page.getByRole('button',{name:'汤类',exact:true}).click();
  await expect(page.locator('.food-gallery article')).toHaveCount(13);
  await dish(page,'紫菜蛋花汤').getByRole('button',{name:'选作午餐',exact:true}).click();
  await expect(menu(page,'午餐').locator('.menu-dish')).toHaveCount(3);
  expect(readChoices('2026-10-05','lunch',state.writes[0].body.content).map(food=>food.name)).toEqual(['辣椒炒腊肉','清蒸鱼','紫菜蛋花汤']);
  await dish(page,'莲藕排骨汤').getByRole('button',{name:'选作晚餐',exact:true}).click();
  await expect(menu(page,'晚餐')).toContainText('莲藕排骨汤');
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  await page.locator('.food-library').screenshot({path:info.outputPath('soups.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await menu(page,'午餐').getByRole('button',{name:'移除午餐中的清蒸鱼',exact:true}).click();
  await expect(menu(page,'午餐').getByRole('heading',{name:'清蒸鱼',exact:true})).toHaveCount(0);
  await page.reload();
  await expect(menu(page,'午餐').locator('.menu-dish')).toHaveCount(2);
  await expect(menu(page,'午餐')).toContainText('紫菜蛋花汤');
  await expect(menu(page,'晚餐')).toContainText('莲藕排骨汤');
  await expect(menu(page,'午餐').getByRole('heading',{name:'清蒸鱼',exact:true})).toHaveCount(0);
});

test('菜品按六类分组并可筛选，跨分类选菜保留菜单且数量准确',async({page},info)=>{
  const state=await workspace(page);
  const filters=page.getByRole('group',{name:'食物类别',exact:true});
  await expect(filters.getByRole('button',{name:'全部',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.food-group')).toHaveCount(6);
  const names=await page.locator('.food-gallery article').evaluateAll(rows=>rows.map(row=>row.getAttribute('aria-label')));
  expect(new Set(names).size).toBe(135);expect(names).toHaveLength(135);
  const counts=[37,34,29,9,13,13];
  for(const [index,group] of foodGroups.entries()) {
    const filter=filters.getByRole('button',{name:group.name,exact:true});
    await expect(filter.locator('.category-count')).toHaveText(String(counts[index]));
    await filter.click();await expect(filter).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.food-group')).toHaveCount(1);
    await expect(page.locator('.food-group-heading h3')).toHaveText(group.name);
    await expect(page.locator('.food-gallery article')).toHaveCount(counts[index]!);
    expect(await page.locator('.food-gallery article').evaluateAll(rows=>rows.map(row=>row.getAttribute('aria-label')))).toEqual(foods.filter(food=>food.group===group.id).map(food=>food.name));
  }
  await filters.getByRole('button',{name:'蔬菜',exact:true}).click();
  await dish(page,'蒜蓉空心菜').getByRole('button',{name:'选作午餐',exact:true}).click();
  await expect(menu(page,'午餐')).toContainText('蒜蓉空心菜');
  await filters.getByRole('button',{name:'肉类',exact:true}).click();
  await dish(page,'辣椒炒腊肉').getByRole('button',{name:'选作午餐',exact:true}).click();
  await expect(menu(page,'午餐').locator('.menu-dish')).toHaveCount(2);
  await filters.getByRole('button',{name:'蔬菜',exact:true}).click();
  await expect(dish(page,'蒜蓉空心菜').getByRole('button',{name:'已选作午餐',exact:true})).toBeDisabled();
  expect(state.writes).toHaveLength(2);
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  for(const theme of ['warm','dark']) {
    await page.evaluate(async value=>{const path='/src/themes.ts';(await import(path)).applyTheme(value);},theme);
    await page.locator('.food-library').screenshot({path:info.outputPath('categories-'+theme+'.png')});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await filters.getByRole('button',{name:'全部',exact:true}).click();
  await expect(page.locator('.food-group')).toHaveCount(6);
  await expect(menu(page,'午餐')).toContainText('蒜蓉空心菜');
  await expect(menu(page,'午餐')).toContainText('辣椒炒腊肉');
});

test('菜品库按钮直接加入三餐菜单，去重且刷新恢复',async({page},info)=>{
  const state=await workspace(page);
  for(const name of ['长沙米粉','茶叶蛋']) {
    await dish(page,name).getByRole('button',{name:'选作早餐',exact:true}).click();
    await expect(menu(page,'早餐').getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(dish(page,name).getByRole('button',{name:'已选作早餐',exact:true})).toBeDisabled();
  }
  await expect(menu(page,'早餐').locator('.menu-dish')).toHaveCount(2);
  await page.getByRole('button',{name:'全部',exact:true}).click();
  for(const mealName of ['午餐','晚餐']) {
    for(const name of ['蒜蓉空心菜','木耳炒黄瓜']) {
      await dish(page,name).getByRole('button',{name:'选作'+mealName,exact:true}).click();
      await expect(menu(page,mealName).getByRole('heading',{name,exact:true})).toBeVisible();
      await expect(dish(page,name).getByRole('button',{name:'已选作'+mealName,exact:true})).toBeDisabled();
      await expect(page.locator('.food-library').getByRole('status')).toHaveCount(0);
    }
    await expect(menu(page,mealName).locator('.menu-dish')).toHaveCount(2);
  }
  expect(state.writes).toHaveLength(6);
  await dish(page,'蒜蓉空心菜').scrollIntoViewIfNeeded();
  await dish(page,'蒜蓉空心菜').screenshot({path:info.outputPath('library-selected.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await menu(page,'午餐').getByRole('button',{name:'移除午餐中的蒜蓉空心菜',exact:true}).click();
  await expect(dish(page,'蒜蓉空心菜').getByRole('button',{name:'选作午餐',exact:true})).toBeEnabled();
  await expect(dish(page,'蒜蓉空心菜').getByRole('button',{name:'已选作晚餐',exact:true})).toBeDisabled();
  await dish(page,'蒜蓉空心菜').getByRole('button',{name:'选作午餐',exact:true}).click();
  await expect(menu(page,'午餐').locator('.menu-dish')).toHaveCount(2);
  await page.reload();
  for(const mealName of ['早餐','午餐','晚餐'])await expect(menu(page,mealName).locator('.menu-dish')).toHaveCount(2);
});

test('午餐及其他两餐点击播放后，按钮保留焦点或鼠标停留也能自动轮播',async({page},info)=>{
  const state=await workspace(page);
  for(const mealName of ['午餐','早餐','晚餐']) {
    const meal=card(page,mealName);
    await meal.getByRole('button',{name:mealName+'下一道',exact:true}).click();
    const before=await meal.locator('.carousel-current').getAttribute('alt');
    await meal.getByRole('button',{name:'播放'+mealName+'轮播',exact:true}).click();
    const playback=meal.getByRole('button',{name:'暂停'+mealName+'轮播',exact:true});
    if(info.project.name==='desktop')await expect(playback).toBeFocused();
    await page.mouse.move(0,0);
    await page.clock.runFor(5500);
    await expect(meal.locator('.carousel-current')).not.toHaveAttribute('alt',before!);
    const current=await meal.locator('.carousel-current').getAttribute('alt');
    await expect(meal.getByRole('heading',{name:current!,exact:true})).toBeVisible();
    if(info.project.name==='desktop') {
      await meal.getByRole('group',{name:mealName+'菜品轮播'}).focus();
      await page.clock.runFor(5500);
      await expect(meal.locator('.carousel-current')).toHaveAttribute('alt',current!);
      await playback.focus();
      await playback.hover();await page.clock.runFor(5500);
      await expect(meal.locator('.carousel-current')).not.toHaveAttribute('alt',current!);
    }
    await playback.click();
    await expect(meal.getByRole('button',{name:'播放'+mealName+'轮播',exact:true})).toBeVisible();
  }
  expect(state.writes).toHaveLength(0);
});

test('三餐轮播支持前后切换、键盘和暂停；浏览不写入菜单',async({page})=>{
  const state=await workspace(page);
  await expect(menu(page,'早餐')).toContainText('待选择');
  const breakfast=card(page,'早餐'),before=await breakfast.locator('.carousel-current').getAttribute('alt');
  await breakfast.getByRole('button',{name:'早餐下一道',exact:true}).click();
  await expect(breakfast.locator('.carousel-current')).not.toHaveAttribute('alt',before!);
  await expect(breakfast.getByRole('button',{name:'播放早餐轮播'})).toBeVisible();
  await breakfast.getByRole('button',{name:'早餐上一道',exact:true}).click();
  await expect(breakfast.locator('.carousel-current')).toHaveAttribute('alt',before!);
  await breakfast.getByRole('group',{name:'早餐菜品轮播'}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(breakfast.locator('.carousel-current')).not.toHaveAttribute('alt',before!);
  expect(state.writes).toHaveLength(0);
  await expect(menu(page,'早餐')).toContainText('待选择');
});

test('自动轮播同步菜名，悬停和暂停时保持菜品；确认菜单不受后续浏览影响',async({page})=>{
  const state=await workspace(page),breakfast=card(page,'早餐');
  await breakfast.scrollIntoViewIfNeeded();await page.mouse.move(0,0);
  const before=await breakfast.locator('.carousel-current').getAttribute('alt');
  await page.clock.runFor(5500);
  await expect(breakfast.locator('.carousel-current')).not.toHaveAttribute('alt',before!);
  const current=(await breakfast.locator('.carousel-current').getAttribute('alt'))!;
  await expect(breakfast.getByRole('heading',{name:current,exact:true})).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await breakfast.hover();await page.clock.runFor(10000);
  await expect(breakfast.locator('.carousel-current')).toHaveAttribute('alt',current);
  await breakfast.getByRole('button',{name:'暂停早餐轮播'}).click();
  await page.mouse.move(0,0);await page.clock.runFor(10000);
  await expect(breakfast.locator('.carousel-current')).toHaveAttribute('alt',current);
  await breakfast.getByRole('button',{name:'加入菜单',exact:true}).click();
  await expect(menu(page,'早餐').getByRole('heading',{name:current,exact:true})).toBeVisible();
  await breakfast.getByRole('button',{name:'早餐下一道',exact:true}).click();
  await expect(breakfast.locator('.carousel-current')).not.toHaveAttribute('alt',current);
  await expect(menu(page,'早餐').getByRole('heading',{name:current,exact:true})).toBeVisible();
  expect(state.writes).toHaveLength(1);
  await page.reload();
  await expect(menu(page,'早餐').getByRole('heading',{name:current,exact:true})).toBeVisible();
  await expect(card(page,'早餐').getByRole('button',{name:'播放早餐轮播'})).toBeVisible();
});

test('保存成功才进入菜单，同餐继续添加菜单，账号切换和跨日清空菜单',async({page})=>{
  const state=await workspace(page);
  state.saveFailure(true);await dish(page,'长沙米粉').getByRole('button',{name:'选作早餐',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('记忆暂时无法保存');
  await expect(menu(page,'早餐')).toContainText('待选择');
  await expect(page.locator('.food-library').getByRole('status')).toContainText('添加失败');
  await expect(dish(page,'长沙米粉').getByRole('button',{name:'选作早餐',exact:true})).toBeEnabled();
  state.saveFailure(false);await dish(page,'长沙米粉').getByRole('button',{name:'选作早餐',exact:true}).click();
  await expect(menu(page,'早餐')).toContainText('长沙米粉');
  await dish(page,'糯米饭团').getByRole('button',{name:'选作早餐'}).click();
  await expect(menu(page,'早餐')).toContainText('糯米饭团');
  await expect(menu(page,'早餐')).toContainText('长沙米粉');
  await expect(dish(page,'糯米饭团').getByRole('button',{name:'已选作早餐',exact:true})).toBeDisabled();
  state.saveFailure(true);
  await menu(page,'早餐').getByRole('button',{name:'移除早餐中的长沙米粉',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('记忆暂时无法保存');
  await expect(menu(page,'早餐')).toContainText('长沙米粉');
  state.saveFailure(false);
  await menu(page,'早餐').getByRole('button',{name:'移除早餐中的长沙米粉',exact:true}).click();
  await expect(menu(page,'早餐')).not.toContainText('长沙米粉');
  await expect(menu(page,'早餐')).toContainText('糯米饭团');
  await page.reload();await expect(menu(page,'早餐')).toContainText('糯米饭团');
  await expect(menu(page,'早餐')).not.toContainText('长沙米粉');
  await state.switchUser();await expect(menu(page,'早餐')).toContainText('待选择');
  await expect(page.getByRole('button',{name:'重新抽取三餐'})).toBeEnabled();
  await dish(page,'豆腐脑').getByRole('button',{name:'选作早餐'}).click();
  await expect(menu(page,'早餐')).toContainText('豆腐脑');
  await page.clock.setSystemTime(new Date('2026-10-05T16:01:00Z'));await page.clock.runFor(60000);
  await expect(menu(page,'早餐')).toContainText('待选择');
});

test('旧单菜菜单保留，多菜刷新恢复，全部移除后不会复活',async({page},info)=>{
  const state=await workspace(page),legacy=foods.find(food=>food.id==='soy-milk')!;
  state.data['food-a'].push({id:'legacy-choice',key:choiceKey('2026-10-05','breakfast'),content:choiceContent('2026-10-05','breakfast',legacy),scope:'life',kind:'interest',effective_state:'active'});
  await page.reload();await expect(menu(page,'早餐')).toContainText('豆浆');
  for(const name of ['长沙米粉','茶叶蛋','蒸玉米']) {
    await dish(page,name).getByRole('button',{name:'选作早餐'}).click();
    await expect(menu(page,'早餐')).toContainText(name);
  }
  await expect(menu(page,'早餐').locator('.menu-dish')).toHaveCount(4);
  await page.reload();await expect(menu(page,'早餐').locator('.menu-dish')).toHaveCount(4);
  await page.getByRole('button',{name:'全部',exact:true}).click();
  for(const mealName of ['午餐','晚餐']) {
    for(const name of ['辣椒炒腊肉','清炒白菜','清蒸鲈鱼','剁椒鱼头']) {
      await dish(page,name).getByRole('button',{name:'选作'+mealName,exact:true}).click();
      await expect(menu(page,mealName)).toContainText(name);
    }
    await expect(menu(page,mealName).locator('.menu-dish')).toHaveCount(4);
  }
  await page.reload();
  for(const mealName of ['早餐','午餐','晚餐'])await expect(menu(page,mealName).locator('.menu-dish')).toHaveCount(4);
  await page.locator('.food-menu').scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('multi-menu.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const name of ['豆浆','长沙米粉','茶叶蛋','蒸玉米']) {
    await menu(page,'早餐').getByRole('button',{name:'移除早餐中的'+name,exact:true}).click();
    await expect(menu(page,'早餐').getByRole('heading',{name,exact:true})).toHaveCount(0);
  }
  await expect(menu(page,'早餐')).toContainText('待选择');
  await page.reload();await expect(menu(page,'早餐')).toContainText('待选择');
  await expect(menu(page,'午餐').locator('.menu-dish')).toHaveCount(4);
  await expect(menu(page,'晚餐').locator('.menu-dish')).toHaveCount(4);
});

test('新图加载前保留旧图，加载后新旧图交叉过渡',async({page})=>{
  await page.addInitScript(()=>{Math.random=()=>0;});
  const pool=foods.filter(food=>food.category==='breakfast'),target=pool[2]!;
  let release=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**'+target.image,async route=>{await held;await route.continue();});
  await workspace(page);
  const breakfast=card(page,'早餐'),next=breakfast.getByRole('button',{name:'早餐下一道',exact:true});
  await next.click();
  await expect(breakfast.locator('.carousel-current')).toHaveAttribute('alt',pool[1]!.name);
  await page.clock.runFor(800);
  await next.click();
  await expect(breakfast.locator('.carousel-current')).toHaveAttribute('alt',pool[1]!.name);
  await expect(breakfast.getByRole('button',{name:'加入菜单',exact:true})).toBeDisabled();
  release();
  await expect(breakfast.locator('.carousel-current')).toHaveAttribute('alt',target.name);
  await expect(breakfast.locator('.meal-carousel img[aria-hidden="true"]')).toHaveCount(1);
  expect(await breakfast.locator('.carousel-current').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.clock.runFor(800);
  await expect(breakfast.locator('.meal-carousel img')).toHaveCount(1);
});

test('整库菜品可写入同一餐，保存格式兼容单菜且完整恢复',()=>{
  expect(new Set(foods.map(food=>food.id)).size).toBe(foods.length);
  expect(new Set(foods.map(food=>food.name)).size).toBe(foods.length);
  expect(foods.some(food=>food.id==='steamed-fish')).toBe(false);
  const legacyPlan=[retiredFoods[0]!,...foods.filter(food=>food.category==='main')];
  expect(readChoices('2026-10-06','lunch',choiceContent('2026-10-06','lunch',legacyPlan)).map(food=>food.id)).toEqual(legacyPlan.map(food=>food.id));
  for(const food of foods)expect(foodGroups.map(group=>group.id)).toContain(food.group);
  for(const [id,group] of [['pepper-cured-pork','meat'],['celery-firm-tofu','eggs-tofu'],['garlic-water-spinach','vegetables'],['winter-melon-ribs','soups'],['steamed-sea-bass','seafood']])expect(foods.find(food=>food.id===id)?.group).toBe(group);
  for(const meal of ['breakfast','lunch','dinner'] as const) {
    const all=foods.filter(food=>food.category===(meal==='breakfast'?'breakfast':'main'));
    const content=choiceContent('2026-10-06',meal,all);
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(readChoices('2026-10-06',meal,content).map(food=>food.id)).toEqual(all.map(food=>food.id));
    expect(choiceContent('2026-10-06',meal,[all[0]!])).toBe(choiceContent('2026-10-06',meal,all[0]!));
    expect(readChoices('2026-10-06',meal,choiceContent('2026-10-06',meal,[]))).toEqual([]);
  }
});

test('减少动态效果时默认暂停，仍可手动切换',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await workspace(page);
  const breakfast=card(page,'早餐'),before=await breakfast.locator('.carousel-current').getAttribute('alt');
  await breakfast.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.clock.runFor(15000);
  await expect(breakfast.locator('.carousel-current')).toHaveAttribute('alt',before!);
  await expect(breakfast.getByRole('button',{name:'播放早餐轮播'})).toBeVisible();
  await breakfast.getByRole('button',{name:'早餐下一道'}).click();
  await expect(breakfast.locator('.carousel-current')).not.toHaveAttribute('alt',before!);
});

test('侧栏顺序、食物图片和三餐抽取；菜单持久保存，刷新恢复',async({page},info)=>{
  const state=await workspace(page),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const links=await page.locator('.sidebar nav a').allTextContents();
  expect(links.findIndex(text=>text.includes('吃点什么'))).toBe(links.findIndex(text=>text.includes('数据管理'))+1);
  await expect(page.locator('.food-kicker')).toContainText('2026-10-05');
  await expect(page.locator('.page-header')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'记住我的口味',exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'口味偏好',exact:true})).toHaveCount(0);
  await expect(page.locator('.food-gallery article')).toHaveCount(135);
  await page.getByRole('button',{name:'早餐',exact:true}).click();
  await expect(page.locator('.food-gallery article')).toHaveCount(37);
  const before=await card(page,'早餐').locator('.carousel-current').getAttribute('alt');
  await card(page,'早餐').getByRole('button',{name:'换一个',exact:true}).click();
  await expect(card(page,'早餐').locator('.carousel-current')).not.toHaveAttribute('alt',before!);
  await page.getByRole('button',{name:'重新抽取三餐',exact:true}).click();
  expect(await card(page,'午餐').locator('.carousel-current').getAttribute('alt')).not.toBe(await card(page,'晚餐').locator('.carousel-current').getAttribute('alt'));
  expect(state.writes).toHaveLength(0);
  for(const food of [...foods,...retiredFoods]){
    for(const source of [food.image,food.thumbnail]){
      const response=await page.request.get(source);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/webp');
      expect((await response.body()).length).toBeLessThan(source===food.image?240_000:90_000);
    }
  }
  await page.getByRole('button',{name:'全部',exact:true}).click();
  await expect(page.locator('.food-gallery article')).toHaveCount(135);
  await dish(page,'辣椒炒腊肉').getByRole('button',{name:'选作午餐',exact:true}).click();
  await expect(menu(page,'午餐')).toContainText('辣椒炒腊肉');
  expect(state.writes[0]).toEqual({user:'food-a',csrf:'food-csrf',body:{key:choiceKey('2026-10-05','lunch'),content:choiceContent('2026-10-05','lunch',foods.find(food=>food.id==='pepper-cured-pork')!),scope:'life',kind:'interest',pinned:false}});
  await card(page,'午餐').getByRole('button',{name:'换一个',exact:true}).click();
  await expect(menu(page,'午餐').locator('.menu-dish')).toHaveCount(1);expect(state.writes).toHaveLength(1);
  await page.reload();await expect(card(page,'午餐').getByRole('button',{name:'已在菜单',exact:true})).toBeDisabled();
  await expect(card(page,'午餐').locator('.carousel-current')).toHaveAttribute('alt','辣椒炒腊肉');
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:850});
  for(const mealName of ['早餐','午餐','晚餐']) {
    const pause=card(page,mealName).getByRole('button',{name:'暂停'+mealName+'轮播',exact:true});
    if(await pause.count())await pause.click();
  }
  await page.clock.runFor(800);
  for(const image of await page.locator('.food-page img:not([aria-hidden="true"])').all()){
    await image.scrollIntoViewIfNeeded();
    await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  for(const theme of ['warm','dark']){
    await page.evaluate(async value=>{const path='/src/themes.ts';(await import(path)).applyTheme(value);},theme);
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('food-'+theme+'.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('读取和保存失败可重试，失败不冒充已确认；修改同餐只保留一个有效记忆',async({page})=>{
  const state=await workspace(page);state.readFailure(true);await page.reload();
  await expect(page.getByRole('alert')).toContainText('记忆暂时无法读取');
  await expect(dish(page,'长沙米粉').getByRole('button',{name:'选作早餐',exact:true})).toBeDisabled();
  state.readFailure(false);await page.getByRole('button',{name:'重新读取记忆',exact:true}).click();
  state.saveFailure(true);await dish(page,'长沙米粉').getByRole('button',{name:'选作早餐',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('记忆暂时无法保存');
  await expect(menu(page,'早餐')).toContainText('待选择');
  await expect(dish(page,'长沙米粉').getByRole('button',{name:'选作早餐',exact:true})).toBeEnabled();
  state.saveFailure(false);await dish(page,'长沙米粉').getByRole('button',{name:'选作早餐',exact:true}).click();
  await expect(menu(page,'早餐')).toContainText('长沙米粉');
  await dish(page,'馒头').getByRole('button',{name:'选作早餐',exact:true}).click();
  await expect(menu(page,'早餐')).toContainText('馒头');
  expect(state.data['food-a'].filter(memory=>memory.key===choiceKey('2026-10-05','breakfast') && memory.effective_state==='active')).toHaveLength(1);
  await page.reload();await expect(card(page,'早餐').locator('.carousel-current')).toHaveAttribute('alt','馒头');
});

test('切换账号清空菜单，旧账号延迟保存不进入新账号页面',async({page})=>{
  const state=await workspace(page);
  state.hold();await dish(page,'长沙米粉').getByRole('button',{name:'选作早餐',exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(1);
  await state.switchUser();
  await expect(page.locator('.food-kicker')).toContainText('2026-10-04');
  await expect(menu(page,'早餐')).toContainText('待选择');
  const response=page.waitForResponse(value=>value.url().endsWith('/memories') && value.request().method()==='POST');
  state.release();await (await response).finished();
  await expect(menu(page,'早餐')).toContainText('待选择');expect(state.data['food-b']).toHaveLength(0);
  await expect(page.locator('.food-library').getByRole('status')).toHaveCount(0);
  await card(page,'早餐').getByRole('button',{name:'加入菜单',exact:true}).click();
  await expect(card(page,'早餐').getByRole('button',{name:'已在菜单',exact:true})).toBeDisabled();
  expect(state.writes[1].user).toBe('food-b');expect(state.writes[1].body.key).toBe('food:choice:2026-10-04:breakfast');
});

test('账号时区跨日后重新读取今日三餐，旧日期不会被覆盖',async({page})=>{
  const state=await workspace(page);
  await card(page,'早餐').getByRole('button',{name:'加入菜单',exact:true}).click();
  await expect(card(page,'早餐').getByRole('button',{name:'已在菜单',exact:true})).toBeDisabled();
  await page.clock.setSystemTime(new Date('2026-10-05T16:01:00Z'));await page.clock.runFor(60000);
  await expect(page.locator('.food-kicker')).toContainText('2026-10-06');
  await expect(menu(page,'早餐')).toContainText('待选择');
  await card(page,'早餐').getByRole('button',{name:'加入菜单',exact:true}).click();
  await expect(card(page,'早餐').getByRole('button',{name:'已在菜单',exact:true})).toBeDisabled();
  expect(state.writes[1].body.key).toBe('food:choice:2026-10-06:breakfast');
  expect(state.data['food-a'].filter(memory=>memory.kind==='interest' && memory.effective_state==='active')).toHaveLength(2);
});
