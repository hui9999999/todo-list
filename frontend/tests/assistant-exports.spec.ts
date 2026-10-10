import {test,expect} from '@playwright/test';

test('对话中下载报告，切页和刷新后文件卡片仍可用',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const card={id:'export-1',message_id:'answer',label:'周报',description:'2026-10-05 至 2026-10-11；完成 2 项；专注 45 分钟；当前周期尚未结束',format:'csv',filename:'xiaoqi-weekly-2026-10-05.csv'};
  let attempts=0;
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');let json:any=[];
    if(path==='/me')json={user:{id:'export-user',timezone:'Asia/Shanghai'},csrf_token:'test'};
    if(path==='/settings')json={theme:'light',weather_enabled:false,news_enabled:false};
    if(path==='/model-preferences')json={model:'test'};
    if(path==='/conversations')json=[{id:'chat',title:'导出周报'}];
    if(path==='/conversations/chat/messages')json={messages:[{id:'user',role:'user',content:'导出本周周报为 CSV'},{id:'answer',role:'assistant',content:'报告已生成，你可以直接下载。'}],runs:[{id:'run',status:'completed'}],downloads:[card]};
    if(path==='/agent-runs/run')json={id:'run',status:'completed',answer:'报告已生成，你可以直接下载。',proposals:[]};
    if(path==='/assistant/exports/export-1'){
      if(++attempts===2)return route.fulfill({status:404,json:{detail:'导出记录已清理'}});
      return route.fulfill({contentType:'text/csv',body:'周报,2026-10-05\n完成任务,2\n专注分钟,45',headers:{'Content-Disposition':'attachment; filename="'+card.filename+'"'}});
    }
    await route.fulfill({json});
  });
  await page.goto('/ai');
  const file=page.getByRole('region',{name:'周报导出文件',exact:true});
  await expect(file).toContainText('专注 45 分钟');
  const downloadPromise=page.waitForEvent('download');
  await file.getByRole('button',{name:'下载文件',exact:true}).click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toBe(card.filename);
  await download.saveAs(info.outputPath(card.filename));
  const nav=page.getByRole('navigation',{name:'工作区',exact:true});
  await nav.getByRole('link',{name:'日历',exact:true}).click();
  await nav.getByRole('link',{name:'AI 助手',exact:true}).click();await expect(file).toBeVisible();
  await page.reload();await expect(file).toBeVisible();
  await file.getByRole('button',{name:'下载文件',exact:true}).click();
  await expect(page.getByText('导出记录已清理',{exact:true})).toBeVisible();
  await file.getByRole('button',{name:'下载文件',exact:true}).click();
  await expect(page.getByText('导出文件已生成',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('assistant-export-card.png')});
});
