import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.xiaoqi.todo',
  appName: '小狒待办',
  webDir: 'dist-android',
  android: { backgroundColor: '#f7f9f8' },
  // Keep the packaged UI local. HTTP is allowed for the test server by the debug manifest only.
  server: { androidScheme: 'https' },
  loggingBehavior: 'none',
  plugins: { SystemBars: { insetsHandling: 'native', initialViewportFitValueHint: 'auto' } },
};
export default config;
