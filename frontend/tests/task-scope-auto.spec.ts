import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page){
  const rows:any[]=[];
  const posts:any[]=[];
  const classifiedTitles:string[]=[];
  const infer=(title:string,notes='')=>title.includes('英语')||notes.includes('课程')?'study':title.includes('牛奶')?'life':title.includes('客户')?'work':'unassigned';
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(), url=new URL(request.url()), path=url.pathname.replace('/api/v1','');
    let json:any=[];
    if(path==='/me')json={user:{id:'auto-scope',email:'auto-scope@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'light',notifications_enabled:false,weather_enabled:false};
    if(path==='/tasks/classify'){
      const body=request.postDataJSON();classifiedTitles.push(body.title);
      json={scope:infer(body.title,body.notes)};
      if(body.title==='买牛奶')await new Promise(resolve=>setTimeout(resolve,650));
    }
    if(path==='/tasks'){
      if(request.method()==='POST'){
        const body=request.postDataJSON();posts.push(body);
        json={...body,id:'task-'+posts.length,version:1,scope:body.scope??infer(body.title,body.notes),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),deleted_at:null,completed_at:null,legacy_period:null};rows.push(json);
      }else json=url.searchParams.has('trash')?[]:rows;
    }
    if(path.startsWith('/tasks/task-') && request.method()==='PUT'){
      const row=rows.find(row=>row.id===path.split('/')[2]);Object.assign(row,request.postDataJSON());json=row;
    }
    await route.fulfill({json});
  });
  await page.goto('/tasks');
  return {posts,classifiedTitles};
}

async function selectScope(page:Page,label:string){
  await page.locator('.el-drawer .el-select').first().click();
  await page.getByRole('option',{name:label,exact:true}).click();
}

test('新任务自动预览分类，手动选择保留，修改现有任务不重新分类',async({page},info)=>{
  const {posts,classifiedTitles}=await setup(page);
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  const title=page.getByRole('textbox',{name:'任务名称',exact:true});
  const choice=page.locator('.el-drawer .el-select').first();
  await title.fill('复习英语单词');
  await expect(choice).toContainText('自动识别 · 学习');
  await title.fill('买牛奶');
  await expect.poll(()=>classifiedTitles.includes('买牛奶')).toBe(true);
  await title.fill('准备客户会议');
  await expect(choice).toContainText('自动识别 · 工作');
  // Wait for the slower previous result and verify it cannot overwrite this one.
  await page.waitForTimeout(700);
  await expect(choice).toContainText('自动识别 · 工作');
  await selectScope(page,'生活');
  await title.fill('复习英语单词');
  await expect(choice).toContainText('生活');
  await page.getByRole('button',{name:'创建任务',exact:true}).click();
  await expect(page.locator('.task-card').filter({hasText:'复习英语单词'})).toContainText('生活');
  expect(posts[0].scope).toBe('life');
  await page.getByRole('button',{name:'复习英语单词',exact:true}).click();
  await title.fill('准备客户会议');
  await expect(choice).toContainText('生活');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.locator('.task-card').filter({hasText:'准备客户会议'})).toContainText('生活');
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await title.fill('准备材料');
  await page.getByRole('textbox',{name:'备注',exact:true}).fill('明天的英语课程');
  await expect(choice).toContainText('自动识别 · 学习');
  await page.screenshot({path:info.outputPath('automatic-scope.png'),fullPage:true});
  await page.getByRole('button',{name:'创建任务',exact:true}).click();
  expect(posts[1]).not.toHaveProperty('scope');
  await expect(page.locator('.task-card').filter({hasText:'准备材料'})).toContainText('学习');
});

test('快捷记录自动分类，指定分类与未分类不被覆盖，快速保存无需等待预览',async({page},info)=>{
  test.skip(info.project.name==='mobile','手机通过新建任务入口记录，快捷记录与分类筛选只在桌面显示');
  const {posts}=await setup(page);
  await page.goto('/tasks?period=week');
  const quick=page.getByRole('textbox',{name:'快速记录任务',exact:true});
  await quick.fill('买牛奶');await quick.press('Enter');
  await expect(page.locator('.task-card').filter({hasText:'买牛奶'})).toContainText('生活');
  expect(posts[0]).not.toHaveProperty('scope');
  const filters=page.locator('.list-toolbar .el-segmented');
  await filters.getByText('工作',{exact:true}).click();
  await quick.fill('复习英语单词');await quick.press('Enter');
  await expect(page.locator('.task-card').filter({hasText:'复习英语单词'})).toContainText('工作');
  expect(posts[1].scope).toBe('work');
  await filters.getByText('未分类',{exact:true}).click();
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await expect(page.locator('.el-drawer .el-select').first()).toContainText('未分类');
  await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('复习英语');
  await page.getByRole('button',{name:'创建任务',exact:true}).click();
  await expect.poll(()=>posts.length).toBe(3);
  expect(posts[2].scope).toBe('unassigned');
  await filters.getByText('全部',{exact:true}).click();
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('准备客户会议');
  await page.getByRole('button',{name:'创建任务',exact:true}).click();
  await expect.poll(()=>posts.length).toBe(4);
  expect(posts[3]).not.toHaveProperty('scope');
  await expect(page.locator('.task-card').filter({hasText:'准备客户会议'})).toContainText('工作');
});
