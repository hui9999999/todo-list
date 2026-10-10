import base from './playwright.config';
export default {
  ...base,
  testMatch: /ai-(recurrence|task-operations)\.spec\.ts/,
  outputDir:'../tmp/ai-recurrence-web-tests',
  use:{...base.use,baseURL:'http://127.0.0.1:5186'},
  webServer:{command:'npx vite preview --host 127.0.0.1 --port 5186 --strictPort',url:'http://127.0.0.1:5186',reuseExistingServer:false},
};
