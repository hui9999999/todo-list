import {test,expect} from '@playwright/test';

test('历史状态标签完整显示，事件与任务状态使用中文',async({page},info)=>{
  await page.route('**/api/v1/**',route=>{
    const path=new URL(route.request().url()).pathname;
    let result:any=[];
    if(path==='/api/v1/me')result={user:{id:'layout-history',email:'layout-history@example.com',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/api/v1/history/search')result={hits:[{event_id:'event',task_id:'task',title:'整理周报',completed:true,occurred_at:'2026-10-02T01:00:00Z',snapshot:{notes:'核对进度'},reason:'匹配任务标题'}],message:'按关键词查找历史'};
    if(path==='/api/v1/tasks/task/events')result=[{id:'event',kind:'status_changed',occurred_at:'2026-10-02T01:00:00Z',after:{title:'整理周报',notes:'核对进度',status:'done'}}];
    return route.fulfill({json:result});
  });
  await page.goto('/ai?tab=history&task=task');
  const tag=page.locator('.history-search .el-tag');
  await expect(tag).toHaveText('当时已完成');
  await expect.poll(()=>tag.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(60);
  await expect(page.getByText(/更改状态 · .* · 已完成/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('history-stable.png'),fullPage:true});
});
