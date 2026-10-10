// Read-only smoke check. Password arrives over stdin, never in arguments or a file.
import {readFileSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
const username=process.argv[2],password=readFileSync(0,'utf8').trim();
if(!username || !password)throw new Error('Provide username and password via stdin');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.goto('http://localhost:5174/auth');
  await page.getByRole('textbox',{name:'邮箱或电话号码',exact:true}).fill(username);
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('heading',{name:'管理后台',exact:true}).waitFor();
  const users=await page.request.get('http://localhost:5174/api/v1/admin/users');
  if(users.status()!==200)throw new Error('Admin user list failed');
  const result=await users.json();
  if(!Number.isInteger(result.total) || result.total<1)throw new Error('Invalid user summary');
  await page.getByRole('button',{name:'AI 人设',exact:true}).click();
  const input=page.getByRole('textbox',{name:'AI 人设描述',exact:true});
  await input.waitFor();
  await expect(input).not.toHaveValue('');
  if(!(await input.inputValue()).includes('AI 待办助手'))throw new Error('Default persona was not loaded');
  const me=await (await page.request.get('http://localhost:5174/api/v1/me')).json();
  if(!me.user.is_admin || me.user.identifier!==username)throw new Error('Wrong administrator identity');
  const logout=await page.request.post('http://localhost:5174/api/v1/auth/logout',{headers:{Origin:'http://localhost:5174','X-CSRF-Token':me.csrf_token}});
  if(logout.status()!==200)throw new Error('Smoke session logout failed');
  console.log('Actual administrator login, user list and persona editor passed. Registered users: '+result.total);
}finally{await browser.close();}
