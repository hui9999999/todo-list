import {test, expect} from '@playwright/test';

for (const delivery of ['events', 'poll']) {
  test(`AI 超时显示原因、恢复发送，并在${delivery==='events' ? '完成事件' : '事件丢失时轮询'}后保留状态`, async ({page}) => {
    await page.route('**/api/v1/me', route => route.fulfill({json: {user: {id: 'timeout-user', email: 'timeout@example.com', timezone: 'Asia/Shanghai'}, csrf_token: 'test'}}));
    await page.route('**/api/v1/settings', route => route.fulfill({json: {theme: 'light'}}));
    for (const path of ['tasks', 'projects', 'daily-plans']) await page.route(`**/api/v1/${path}*`, route => route.fulfill({json: []}));
    await page.route('**/api/v1/model-preferences', route => route.fulfill({json: {model: 'test'}}));
    const message = {id: 'message', role: 'user', content: '删除任务测试的任务'};
    const failure = '模型响应超时（最长等待3分钟），未执行任务变更，请重试';
    let sent = false;
    const run: any = {id: 'timeout-run', status: 'running', error: null, proposals: [], created_at: new Date(Date.now()-45000).toISOString()};
    await page.route('**/api/v1/conversations**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/conversations') return route.fulfill({json: route.request().method()==='POST' ? {id: 'chat', title: '删除测试'} : [{id: 'chat', title: '删除测试'}]});
      if (route.request().method()==='POST') {sent=true; return route.fulfill({status: 202, json: {...run}});}
      return route.fulfill({json: {messages: sent ? [message] : [], runs: sent ? [{...run}] : []}});
    });
    await page.route('**/api/v1/agent-runs/timeout-run', route => route.fulfill({json: {...run}}));
    await page.route('**/api/v1/agent-runs/timeout-run/events?after=*', async route => {
      if (delivery==='poll') {
        // The server finishes while only heartbeats reach the browser.
        run.status='failed'; run.error=failure;
        return route.fulfill({contentType: 'text/event-stream', body: ': heartbeat\n\n'});
      }
      run.status='failed'; run.error=failure;
      return route.fulfill({contentType: 'text/event-stream', body: `id: 1\nevent: error\ndata: ${JSON.stringify({message: failure})}\n\nid: 2\nevent: done\ndata: {"status":"failed"}\n\n`});
    });
    await page.goto('/ai');
    const input = page.getByRole('textbox', {name: '发给 AI 的消息', exact: true});
    await input.fill(message.content); await input.press('Enter');
    if (delivery==='poll') await expect(page.getByRole('status').filter({hasText: '模型响应最长等待 3 分钟'})).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText: failure})).toBeVisible({timeout: 10000});
    await input.fill('删除任务「任务测试」');
    await expect(page.getByRole('button', {name: '发送', exact: true})).toBeEnabled();
    await expect(page.getByRole('button', {name: '取消当前请求'})).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('alert').filter({hasText: failure})).toBeVisible();
    await expect(input).toHaveValue('删除任务「任务测试」');
  });
}
