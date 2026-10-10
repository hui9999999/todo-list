import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

for (const isolatedTest of [false, true]) {
  test(isolatedTest ? '桌宠测试实例不创建托盘图标' : '桌宠重复启动只保留一个托盘，正常退出主动移除图标', async ({}, info) => {
    test.skip(info.project.name !== 'desktop', 'Windows 原生生命周期只验证一次');
    const profile = info.outputPath('native-profile');
    await mkdir(profile, { recursive: true });
    const root = path.resolve('..');
    const executablePath = path.join(root, 'desktop/node_modules/electron/dist/electron.exe');
    const launcher = path.join(root, 'desktop/tests/fixtures/lifecycle.cjs');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    env.XIAOQI_LIFECYCLE_PROFILE = profile;
    env.WORKBENCH_URL = 'http://127.0.0.1:5198';
    delete env.XIAOQI_TEST_DATA;
    if (isolatedTest) env.XIAOQI_TEST_DATA = profile;
    const app = await electron.launch({ executablePath, args: [launcher], env });
    try {
      await expect.poll(() => app.windows().some(page => page.url().endsWith('/pet.html'))).toBe(true);
      expect(await app.evaluate(({ app }) => (app as any).xiaoqiTrayProbe)).toEqual({ created: isolatedTest ? 0 : 1, destroyed: 0 });
      const icons = await app.evaluate(({ app }) => (app as any).xiaoqiIconProbe);
      expect(icons.windows.map((window: any) => window.title)).toEqual(['小狒桌宠', '小狒 · 个人工作台']);
      for (const window of icons.windows) {
        expect(window.size).toEqual({ width: 256, height: 256 });
        expect(window.image).toMatch(/^data:image\/png;base64,/);
      }
      expect(icons.windows[0].image).toBe(icons.windows[1].image);
      await writeFile(info.outputPath('xiaoqi-app-icon.png'), Buffer.from(icons.windows[0].image.split(',')[1], 'base64'));
      if (isolatedTest) expect(icons.tray).toBeNull();
      else {
        const traySize = await app.evaluate(({ nativeImage }, image) => nativeImage.createFromDataURL(image).getSize(), icons.tray);
        expect(traySize).toEqual({ width: 32, height: 32 });
      }
      if (!isolatedTest) {
        const second = spawn(executablePath, [launcher, 'xiaoqi-workbench://workbench?renderStyle=2d'], { env, windowsHide: true, stdio: 'ignore' });
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          second.once('error', reject);
          second.once('exit', resolve);
        });
        expect(exitCode).toBe(0);
        const pet = app.windows().find(page => page.url().endsWith('/pet.html'))!;
        await expect(pet.locator('#sprite')).toHaveAttribute('data-renderer', 'two-dimensional');
        expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
        expect(await app.evaluate(({ app }) => (app as any).xiaoqiTrayProbe.created)).toBe(1);
      }
    } finally { await app.close(); }
    expect(JSON.parse(await readFile(path.join(profile, 'tray-lifecycle.json'), 'utf8'))).toEqual({
      created: isolatedTest ? 0 : 1, destroyed: isolatedTest ? 0 : 1,
    });
  });
}
