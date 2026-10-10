import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

async function account(page:Page){
  const origin='http://localhost:5174',email=`browser-review-${randomUUID()}@example.com`,password='review-test-password';
  const headers:any={Origin:origin};
  expect((await page.request.post('/api/v1/auth/register',{headers,data:{email,password}})).status()).toBe(201);
  const login=await page.request.post('/api/v1/auth/login',{headers,data:{email,password}});
  expect(login.status()).toBe(200);headers['X-CSRF-Token']=(await login.json()).csrf_token;
  return {headers,email};
}

test('逐页检查桌面与手机布局、状态文案和任务详情',async({page},info)=>{
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const {headers,email}=await account(page);
  try{
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const tasks:any[]=[];
    for(const data of [{title:'整理产品迭代计划',scope:'work',notes:'核对下周要交付的事项',priority:'high'},{title:'复习英语单词',scope:'study'},{title:'采购日用品',scope:'life'},{title:'整理周报',scope:'work',status:'done'}]){
      const result=await page.request.post('/api/v1/tasks',{headers,data});expect(result.status()).toBe(201);tasks.push(await result.json());
    }
    expect((await page.request.post('/api/v1/daily-plans',{headers,data:{task_id:tasks[0].id,plan_date:day}})).status()).toBe(200);
    expect((await page.request.post('/api/v1/recurrences',{headers,data:{template:{title:'每周复盘',scope:'work'},frequency:'weekly',interval:1,mode:'calendar',start_date:day}})).status()).toBe(201);
    expect((await page.request.post('/api/v1/memories',{headers,data:{content:'下午集中处理工作',key:'工作时段',scope:'work'}})).status()).toBe(201);
    await page.route('**/api/v1/recommendations?kind=news',route=>route.fulfill({json:[{id:'review-item',kind:'news',title:'本周阅读清单',reason:'围绕当前的学习目标整理资料。',state:'expired',source:null,url:null,published_at:null,bookmarked:false,proposal:null}]}));
    const pages=[['/today','今日清单'],['/tasks?period=year','年度清单'],['/ai','小狒 AI 助手'],['/account?tab=history','历史与记忆'],['/news','资讯'],['/calendar','日历'],['/stats','统计'],['/focus','专注'],['/recurrences','周期任务'],['/data','数据管理'],['/data?tab=backup','数据管理'],['/data?tab=trash','数据管理']];
    for(const [path,title] of pages){
      await page.goto(path);
      if(['资讯','日历','专注','数据管理','统计'].includes(title!)){
        await expect(page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('link',{name:title,exact:true})).toHaveAttribute('aria-current','page');
        await expect(page.getByRole('main')).toBeVisible();
      }else await expect(page.getByRole('heading',{level:title==='历史与记忆'?2:1,name:title,exact:true})).toBeVisible();
      if(path.startsWith('/tasks'))await expect(page.getByRole('button',{name:'整理产品迭代计划',exact:true})).toBeVisible();
      if(path==='/account?tab=history'){
        const tag=page.locator('.history-search .el-tag').first();
        await expect.poll(()=>tag.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(60);
      }
      if(path==='/news')await expect(page.locator('.news-article')).toContainText('本周阅读清单');
      if(path==='/calendar')await expect(page.locator('.calendar-marks .plan-dot').first()).toBeVisible();
      if(path==='/recurrences')await expect(page.locator('.evidence-row').filter({hasText:'每周复盘'})).toContainText('每 1 周');
      if(path==='/stats')await expect(page.getByRole('group',{name:'完成与新增趋势图',exact:true})).toBeVisible();
      if(path==='/data')await expect(page.getByLabel('导出范围预览')).toBeVisible();
      await expect(page.locator('.workspace-main').getByRole('alert')).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);
      await page.screenshot({path:info.outputPath(path.slice(1).replace(/[?=]/g,'-')+'.png'),fullPage:true});
    }
    await page.goto('/tasks');
    await page.getByRole('button',{name:'整理产品迭代计划',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'任务名称',exact:true})).toHaveValue('整理产品迭代计划');
    await expect(page.getByRole('textbox',{name:'备注',exact:true})).toHaveValue('核对下周要交付的事项');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('task-details.png'),fullPage:true});
    expect(errors).toEqual([]);
  }finally{
    // Only this test's freshly created account is removed.
    expect((await page.request.post('/api/v1/account-deletion',{headers,data:{confirm_email:email}})).status()).toBe(200);
  }
});
