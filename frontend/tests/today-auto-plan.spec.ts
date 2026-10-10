import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {recordTask} from './task-entry';

test('真实接口：快捷和专注创建自动加入今日，未来任务改截止后加入，手动移出可保留',async({page},info)=>{
  const email='browser-today-'+randomUUID()+'@example.com',password='browser-test-password';
  const origin='http://localhost:5174';
  let csrf='';
  try {
    const registered=await page.request.post('/api/v1/auth/register',{headers:{origin},data:{email,password,timezone:'Asia/Shanghai'}});
    expect(registered.status()).toBe(201);
    const login=await page.request.post('/api/v1/auth/login',{headers:{origin},data:{email,password}});
    expect(login.ok()).toBe(true);csrf=(await login.json()).csrf_token;
    await page.goto('/tasks');
    const dates=await page.evaluate(()=>{
      const format=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
      return {today:format(new Date()),tomorrow:format(new Date(Date.now()+86400000))};
    });
    await recordTask(page,'快捷创建自动加入今日');
    await expect(page.getByRole('button',{name:'快捷创建自动加入今日',exact:true})).toBeVisible();
    await page.goto('/today');await expect(page.getByRole('button',{name:'快捷创建自动加入今日',exact:true})).toBeVisible();
    await page.goto('/focus');
    const taskInput=page.getByRole('combobox',{name:'专注任务',exact:true});
    await expect(taskInput).toBeEnabled();await taskInput.fill('专注创建自动加入今日');await taskInput.press('Enter');
    await expect(page.locator('.pomodoro-task .el-select')).toContainText('专注创建自动加入今日');
    await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeEnabled();
    await page.goto('/today');await expect(page.getByRole('button',{name:'专注创建自动加入今日',exact:true})).toBeVisible();
    await page.reload();await expect(page.locator('.task-card')).toHaveCount(2);
    await page.goto('/tasks');await page.getByRole('button',{name:'新建任务',exact:true}).click();
    await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('未来截止任务');
    await page.getByLabel('截止时刻',{exact:true}).fill(dates.tomorrow+' 00:00');
    await page.getByLabel('截止时刻',{exact:true}).press('Tab');
    await page.getByRole('button',{name:'创建任务',exact:true}).click();
    await expect(page.getByRole('button',{name:'未来截止任务',exact:true})).toBeVisible();
    await page.goto('/today');await expect(page.locator('.task-card')).toHaveCount(2);
    await page.goto('/tasks');await page.getByRole('button',{name:'未来截止任务',exact:true}).click();
    await page.getByLabel('截止时刻',{exact:true}).fill(dates.today+' 23:59');
    await page.getByLabel('截止时刻',{exact:true}).press('Tab');
    await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('dialog',{name:'任务详情',exact:true})).toBeHidden();
    await page.goto('/today');await expect(page.getByRole('button',{name:'未来截止任务',exact:true})).toBeVisible();
    await expect(page.locator('.task-card')).toHaveCount(3);
    await page.screenshot({path:info.outputPath('today-auto-planned.png'),fullPage:true});
    const future=page.locator('.task-card').filter({hasText:'未来截止任务'});
    if(info.project.name==='mobile')await future.getByRole('button',{name:/^展开任务信息/}).click();
    await future.getByRole('button',{name:'移出今日',exact:true}).click();
    await expect(page.getByRole('button',{name:'未来截止任务',exact:true})).toHaveCount(0);
    await page.goto('/tasks');await page.getByRole('button',{name:'未来截止任务',exact:true}).click();
    await page.getByRole('textbox',{name:'备注',exact:true}).fill('手动移出后，仅更新备注');
    await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('dialog',{name:'任务详情',exact:true})).toBeHidden();
    await page.goto('/today');await expect(page.locator('.task-card')).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {
    if(csrf)expect((await page.request.post('/api/v1/account-deletion',{headers:{origin,'x-csrf-token':csrf},data:{confirm_email:email}})).ok()).toBe(true);
  }
});
