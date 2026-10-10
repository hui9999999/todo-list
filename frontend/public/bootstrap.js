// This stays independent of the module graph so a stale module cannot leave a blank window.
const nativeChromium = window.androidBridge && navigator.userAgent.match(/Chrome\/(\d+)/);
if (nativeChromium && Number(nativeChromium[1]) < 111) {
  const heading = document.querySelector('#startup-status h1');
  if (heading) heading.textContent = '请更新手机的网页内核';
  const message = document.getElementById('startup-message');
  if (message) message.textContent = '请在应用商店更新“安卓系统 WebView”（或 Chrome），然后重新打开小狒待办。';
  const retry = document.getElementById('startup-retry');
  if (retry) {
    retry.hidden = false;
    retry.textContent = '已更新，重新加载';
    retry.addEventListener('click', () => location.reload());
  }
} else setTimeout(() => {
  const status = document.getElementById('startup-status');
  if (!status) return;
  status.querySelector('h1').textContent = '页面暂时无法加载';
  document.getElementById('startup-message').textContent = '服务可能正在重启。重新加载后再试一次。';
  const retry = document.getElementById('startup-retry');
  retry.hidden = false;
  retry.addEventListener('click', () => location.reload());
}, 10000);
