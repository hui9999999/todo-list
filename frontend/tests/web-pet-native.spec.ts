import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

test('真实桌面版等待网页释放、关闭后恢复网页，断网不会出现两只',async({page},info)=>{
  test.skip(info.project.name!=='desktop','原生 Windows 交接只需验证一次');test.setTimeout(90000);
  const origin='http://localhost:5174',identifier=`web-native-${randomUUID()}@example.com`,password='web-native-test-password';
  const registration=await page.request.post('/api/v1/auth/register',{headers:{Origin:origin},data:{identifier,password}});
  expect(registration.status()).toBe(201);const session=await registration.json();
  let app:ElectronApplication|undefined,holdAck=false,releaseAck=()=>{};
  const gate=new Promise<void>(resolve=>{releaseAck=resolve;});
  try{
    await page.goto('/today');
    const web=page.getByRole('region',{name:'网页小狒',exact:true});await expect(web).toBeVisible();
    // Hold the browser's hidden acknowledgement, leaving its visible lease on
    // the server. Native rendering must remain hidden throughout this interval.
    await page.route('**/api/v1/auth/desktop-link/presence',async route=>{
      if(holdAck&&route.request().postDataJSON().hidden)await gate;
      await route.continue();
    });
    holdAck=true;
    const link=await page.request.post('/api/v1/auth/desktop-link',{headers:{Origin:origin,'X-CSRF-Token':session.csrf_token}});
    expect(link.status()).toBe(201);const ticket=(await link.json()).ticket;
    const root=path.resolve('..');
    app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop/tests/fixtures/cloud-account.cjs'),`xiaoqi-workbench://pet?origin=${encodeURIComponent(origin)}&ticket=${ticket}`],env:{...process.env,XIAOQI_TEST_DATA:info.outputPath('native-profile')}});
    await expect.poll(()=>app!.windows().length).toBe(2);
    const nativeVisible=()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find((win:any)=>win.getTitle()==='小狒桌宠')!.isVisible());
    await expect(web).toHaveCount(0);
    expect(await nativeVisible()).toBe(false);
    releaseAck();holdAck=false;
    await expect.poll(nativeVisible,{timeout:10000}).toBe(true);
    await expect(web).toHaveCount(0);
    const native=app.windows().find(p=>p.url().includes('pet.html'))!;
    await expect(native.locator('#sprite')).toHaveAttribute('data-ready','true');
    await native.screenshot({path:info.outputPath('native-handoff.png'),omitBackground:true});
    // Break only native presence renewal. Its own 8s lease must end before the
    // browser may resume after the server's 12s timeout.
    await app.evaluate(({session})=>{
      const web=session.fromPartition('persist:xiaoqi-workbench'),fetch=web.fetch.bind(web);
      web.fetch=((url:any,options:any)=>String(url).endsWith('/desktop-link/session')?Promise.reject(new Error('test offline')):fetch(url,options)) as typeof web.fetch;
    });
    await expect.poll(nativeVisible,{timeout:12000}).toBe(false);
    await expect(web).toBeVisible({timeout:10000});
    expect(await nativeVisible()).toBe(false);
    await app.close();app=undefined;
  }finally{
    releaseAck();await app?.close();
    const login=await page.request.post('/api/v1/auth/login',{headers:{Origin:origin},data:{identifier,password}});
    if(login.ok())await page.request.post('/api/v1/account-deletion',{headers:{Origin:origin,'X-CSRF-Token':(await login.json()).csrf_token},data:{confirm_identifier:identifier}});
  }
});
