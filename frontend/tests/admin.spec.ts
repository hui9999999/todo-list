import {test,expect,type Page} from '@playwright/test';

const zero={calls:0,input_tokens:0,output_tokens:0,reported_tokens:0,pending_calls:0,unknown_calls:0,unreported_calls:0,unreported_reserved_tokens:0};
const used={...zero,calls:3,input_tokens:1200,output_tokens:300,reported_tokens:1500,unknown_calls:1,unreported_calls:1,unreported_reserved_tokens:9000};
const registered='2026-10-05T02:00:00Z';
const alice={id:'alice',nickname:'小明',identifier:'alice@example.com',email:'alice@example.com',is_admin:false,created_at:registered,timezone:'Asia/Shanghai',usage:used};
async function mock(page:Page,{isAdmin=true,loggedIn=true,conflict=false,failUsers=false,emptyUsage=false,longPeriod=false}={}){
  let persona={content:'你是小狒，一位温和、务实的工作伙伴。',default_content:'你是小狒，一位温和、务实的工作伙伴。',version:1,updated_at:registered,updated_by:null as string|null};
  const state={queries:[] as URLSearchParams[],saves:[] as {content:string;version:number}[],adminRequests:0};
  const session={user:{id:'admin-user',identifier:isAdmin?'admin123':'ordinary@example.com',nickname:'管理员',is_admin:isAdmin,timezone:'Asia/Shanghai'},csrf_token:'test-admin-csrf'};
  await page.route('**/api/v1/**',route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith('/me'))return route.fulfill({status:loggedIn?200:401,json:loggedIn?session:{detail:'请先登录'}});
    if(p.endsWith('/auth/login')){loggedIn=true;return route.fulfill({json:session});}
    if(p.includes('/admin/'))state.adminRequests++;
    if(p.endsWith('/admin/users')){
      const params=new URL(route.request().url()).searchParams;state.queries.push(params);
      if(failUsers)return route.fulfill({status:503,json:{detail:'数据服务暂时不可用，请稍后重试'}});
      const selected=params.get('q')?.trim();
      const items=selected==='没有这个用户'?[]:[alice];
      return route.fulfill({json:{items,total:items.length,page:Number(params.get('page')||1),page_size:20,summary:{...used,total_users:2}}});
    }
    if(p.endsWith('/admin/users/alice/usage'))return route.fulfill({json:{user:alice,summary:emptyUsage?zero:used,
      period:{start:longPeriod?'2026-01-01':'2026-10-01',end:'2026-10-05'},
      daily:emptyUsage?[]:[{...used,date:'2026-10-01',input_tokens:200,output_tokens:50,reported_tokens:250},{...used,date:'2026-10-05',input_tokens:1000,output_tokens:250,reported_tokens:1250}],
      models:emptyUsage?[]:[{...used,provider:'deepseek',model:'deepseek-flash'}],
      events:emptyUsage?[]:[{id:'event',provider:'deepseek',model:'deepseek-flash',purpose:'chat',state:'unknown',input_tokens:null,output_tokens:null,reserved_tokens:9000,local_date:'2026-10-05',created_at:registered}]}});
    if(p.endsWith('/admin/persona')){
      if(route.request().method()==='PUT'){
        const body=route.request().postDataJSON();state.saves.push(body);
        expect(route.request().headers()['x-csrf-token']).toBe(session.csrf_token);
        if(conflict)return route.fulfill({status:409,json:{detail:'人设已被更新，请重新读取后再保存'}});
        persona={...persona,...body,version:persona.version+1,updated_by:session.user.id};
      }
      return route.fulfill({json:persona});
    }
    if(p.endsWith('/settings'))return route.fulfill({json:{version:1,theme:'warm',weather_enabled:false,notifications_enabled:false}});
    return route.fulfill({json:[]});
  });
  return state;
}

test('管理员登录后进入后台，显示用户及用量、日期筛选与未知用量明细',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const state=await mock(page,{loggedIn:false});
  await page.goto('/auth');
  await page.getByRole('textbox',{name:'邮箱或电话号码',exact:true}).fill('admin123');
  await page.getByLabel('密码',{exact:true}).fill('test-admin-password-123');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading',{name:'管理后台',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'管理后台',exact:true})).toBeVisible();
  const list=page.getByLabel('注册用户列表',{exact:true});
  await expect(list).toContainText('alice@example.com');
  await expect(list).toContainText('1,500');
  await page.getByLabel('用量开始日期',{exact:true}).fill('2026-10-01');
  await page.getByLabel('用量结束日期',{exact:true}).fill('2026-10-05');
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await expect.poll(()=>state.queries.length).toBe(2);
  expect(state.queries[1].get('start')).toBe('2026-10-01');
  expect(state.queries[1].get('end')).toBe('2026-10-05');
  await page.screenshot({path:info.outputPath('admin-users.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'查看 alice@example.com 的信息',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'用户信息与用量',exact:true});
  const trend=dialog.getByRole('group',{name:'用户 Token 用量趋势图',exact:true});
  await expect(trend).toBeVisible();
  const firstDay=trend.getByRole('img',{name:'2026-10-01，输入 Token 200 Token，输出 Token 50 Token',exact:true});
  await firstDay.focus();
  await expect(dialog.getByLabel('Token 趋势',{exact:true}).locator('.chart-readout')).toContainText('输入 Token 200');
  await expect(trend.getByRole('img',{name:'2026-10-02，输入 Token 0 Token，输出 Token 0 Token',exact:true})).toHaveCount(1);
  await expect(dialog.getByRole('img',{name:'Token 占比：输入 1,200，输出 300',exact:true})).toBeVisible();
  await expect(dialog.getByLabel('输入输出占比',{exact:true})).toContainText('80%');
  await expect(dialog.getByRole('group',{name:'各模型 Token 用量图',exact:true})).toContainText('deepseek-flash');
  await dialog.locator('.admin-detail-scroll').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:info.outputPath('admin-user-charts.png')});
  await dialog.getByLabel('输入输出占比',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('admin-user-distribution.png')});
  const calls=dialog.getByRole('group',{name:'用户调用用量报告状态图',exact:true});
  await expect(calls.getByRole('img',{name:'已报告完整，调用次数 2 次',exact:true})).toHaveCount(1);
  await expect(calls.getByRole('img',{name:'其他未报告完整，调用次数 1 次',exact:true})).toHaveCount(1);
  await calls.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('admin-user-call-status.png')});
  expect(await dialog.locator('.admin-detail-scroll').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await expect(dialog).toContainText('deepseek-flash');
  await expect(dialog).toContainText('用量未知');
  await expect(dialog).toContainText('9,000 Token，仅为预算预留');
  await dialog.getByText('查看调用明细（最近 100 条）',{exact:true}).click();
  await expect(dialog).toContainText('— / —');
  await page.screenshot({path:info.outputPath('admin-user-detail.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('无用量用户显示零值图表和空状态，长周期按完整日期分桶',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await mock(page,{emptyUsage:true});
  await page.goto('/admin');
  await page.getByRole('button',{name:'查看 alice@example.com 的信息',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'用户信息与用量',exact:true});
  await expect(dialog.getByRole('group',{name:'用户 Token 用量趋势图',exact:true}).getByRole('img')).toHaveCount(5);
  await expect(dialog.getByText('尚无已报告的 Token 用量。',{exact:true})).toBeVisible();
  await expect(dialog.getByText('暂无模型调用记录。',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('admin-user-empty.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.unroute('**/api/v1/**');
  await mock(page,{longPeriod:true});
  await page.reload();
  await page.getByRole('button',{name:'查看 alice@example.com 的信息',exact:true}).click();
  await expect(dialog.getByLabel('Token 趋势',{exact:true})).toContainText('每 30 天合计展示');
  const last=dialog.getByRole('group',{name:'用户 Token 用量趋势图',exact:true}).getByRole('img').last();
  await expect(last).toHaveAttribute('aria-label','2026-09-28 ～ 2026-10-05，输入 Token 1200 Token，输出 Token 300 Token');
  expect(errors).toEqual([]);
});

test('修改人设保存新版本，标签切换保留草稿，默认人设需显式保存',async({page},info)=>{
  const state=await mock(page);
  await page.goto('/admin');
  await page.getByRole('button',{name:'AI 人设',exact:true}).click();
  const input=page.getByRole('textbox',{name:'AI 人设描述',exact:true});
  await expect(input).toHaveValue('你是小狒，一位温和、务实的工作伙伴。');
  await input.fill('你是小狒，回答简洁，先理解需求，再给出可执行的小步骤。');
  await page.getByRole('button',{name:'用户与用量',exact:true}).click();
  await page.getByRole('button',{name:'AI 人设',exact:true}).click();
  await expect(input).toHaveValue('你是小狒，回答简洁，先理解需求，再给出可执行的小步骤。');
  await page.getByRole('button',{name:'保存人设',exact:true}).click();
  await expect(page.getByText('AI 人设已保存，后续聊天将使用新人设',{exact:true})).toBeVisible();
  expect(state.saves).toEqual([{version:1,content:'你是小狒，回答简洁，先理解需求，再给出可执行的小步骤。'}]);
  await expect(page.getByRole('button',{name:'保存人设',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'填入默认人设',exact:true}).click();
  await expect(input).toHaveValue('你是小狒，一位温和、务实的工作伙伴。');
  expect(state.saves.length).toBe(1);
  await page.screenshot({path:info.outputPath('admin-persona.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('保存冲突保留人设草稿，失败不会提示成功',async({page})=>{
  await mock(page,{conflict:true});
  await page.goto('/admin');
  await page.getByRole('button',{name:'AI 人设',exact:true}).click();
  const input=page.getByRole('textbox',{name:'AI 人设描述',exact:true});
  await expect(input).toBeEnabled();
  await input.fill('保留这份草稿');
  await page.getByRole('button',{name:'保存人设',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('人设已被更新，请重新读取后再保存');
  await expect(input).toHaveValue('保留这份草稿');
  await expect(page.getByText('AI 人设已保存，后续聊天将使用新人设',{exact:true})).toHaveCount(0);
});

test('普通用户无法进入管理页，导航中无管理入口',async({page})=>{
  const state=await mock(page,{isAdmin:false});
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('link',{name:'管理后台',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'管理后台',exact:true})).toHaveCount(0);
  expect(state.adminRequests).toBe(0);
});

test('用户查询失败提示错误，搜索空结果正常显示',async({page})=>{
  const state=await mock(page);
  await page.goto('/admin');
  await expect(page.getByLabel('注册用户列表',{exact:true})).toContainText('alice@example.com');
  await page.getByRole('textbox',{name:'搜索注册用户',exact:true}).fill('没有这个用户');
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await expect(page.getByText('没有匹配的注册用户',{exact:true})).toBeVisible();
  expect(state.queries.at(-1)!.get('q')).toBe('没有这个用户');
  await page.route('**/api/v1/admin/users?*',route=>route.fulfill({status:503,json:{detail:'数据服务暂时不可用，请稍后重试'}}));
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('数据服务暂时不可用');
  await expect(page.getByLabel('注册用户列表',{exact:true})).toHaveCount(0);
});
