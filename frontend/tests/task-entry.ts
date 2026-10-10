import type {Page} from '@playwright/test';

// Phones use the main task editor; wider layouts also offer quick capture.
export async function recordTask(page:Page,title:string){
  const quick=page.getByRole('textbox',{name:'快速记录任务',exact:true});
  if(await quick.isVisible()){
    await quick.fill(title);
    await page.getByRole('button',{name:'记录任务',exact:true}).click();
  }else{
    await page.getByRole('button',{name:'新建任务',exact:true}).click();
    await page.getByRole('textbox',{name:'任务名称',exact:true}).fill(title);
    await page.getByRole('button',{name:'创建任务',exact:true}).click();
  }
}
