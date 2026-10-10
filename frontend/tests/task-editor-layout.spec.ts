import {test, expect} from '@playwright/test';

test('精简新建表单保留高级设置，固定按钮保存失败后可重试', async ({page}) => {
  page.setDefaultTimeout(10000);
  const posts:any[]=[];
  let fail=true;
  await page.route('**/api/v1/**', async route => {
    const request=route.request(), path=new URL(request.url()).pathname.replace('/api/v1','');
    let json:any=[];
    if(path==='/me')json={user:{id:'editor-layout-test',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'dark',notifications_enabled:false,weather_enabled:false};
    if(path==='/tasks/classify')json={scope:'work'};
    if(path==='/projects')json=[{id:'interview-project',title:'面试准备'}];
    if(path==='/tasks' && request.method()==='POST') {
      posts.push(request.postDataJSON());
      if(fail)return route.fulfill({status:503,json:{detail:'保存暂时失败'}});
      json={...posts.at(-1),id:'created-task',version:1};
    }
    await route.fulfill({json});
  });
  await page.goto('/tasks');
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'新建任务',exact:true});
  const more=drawer.locator('.editor-more');
  await expect(more).not.toHaveAttribute('open');
  await expect(drawer.getByRole('radiogroup',{name:'截止时间类型'}).getByText('重复',{exact:true})).toBeVisible();
  await expect(more.getByRole('combobox',{name:'重复频率',exact:true})).toHaveCount(0);
  await expect(drawer.getByRole('combobox',{name:'任务状态',exact:true})).toBeHidden();
  await expect(drawer.locator('.task-status-help,.help-disclosure')).toHaveCount(0);
  await drawer.getByRole('textbox',{name:'任务名称',exact:true}).fill('准备面试');
  await drawer.getByRole('textbox',{name:'备注',exact:true}).fill('整理项目经历');
  await more.locator('summary').first().click();
  await drawer.getByRole('combobox',{name:'项目',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'面试准备',exact:true}).click();
  await drawer.getByRole('spinbutton',{name:'预计分钟',exact:true}).fill('45');
  await drawer.getByText('在常规清单中隐藏',{exact:true}).click();
  await more.locator('summary').first().click();
  await expect(more).not.toHaveAttribute('open');
  const save=drawer.getByRole('button',{name:'创建任务',exact:true});
  await expect(save).toBeInViewport();
  await save.click();
  await expect(page.getByText('保存暂时失败',{exact:true})).toBeVisible();
  await expect(drawer.getByRole('textbox',{name:'任务名称',exact:true})).toHaveValue('准备面试');
  expect(posts[0]).toMatchObject({title:'准备面试',notes:'整理项目经历',status:'todo',priority:'mid',project_id:'interview-project',estimated_minutes:45,hidden:true});
  expect(posts[0]).not.toHaveProperty('scope');
  fail=false;
  await save.click();
  await expect(drawer).toBeHidden();
  expect(posts[1]).toEqual(posts[0]);
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await expect(more).not.toHaveAttribute('open');
  await expect(drawer.getByRole('textbox',{name:'任务名称',exact:true})).toHaveValue('');
  await more.locator('summary').first().click();
  await expect(drawer.getByRole('checkbox',{name:'在常规清单中隐藏',exact:true})).not.toBeChecked();
  await expect(drawer.getByRole('spinbutton',{name:'预计分钟',exact:true})).toHaveValue('');
});
