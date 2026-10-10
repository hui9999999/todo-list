'use strict';
// Observe the real tray lifecycle without registering the test launcher as a URL handler.
const electron = require('electron');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const profile = process.env.XIAOQI_LIFECYCLE_PROFILE;
if (!profile) throw new Error('An isolated lifecycle profile is required');
electron.app.setPath('userData', profile);
const setPath = electron.app.setPath.bind(electron.app);
electron.app.setPath = (name, value) => setPath(name, name === 'userData' ? profile : value);
electron.app.setAsDefaultProtocolClient = () => true;
const probe = electron.app.xiaoqiTrayProbe = { created: 0, destroyed: 0 };
const icons = electron.app.xiaoqiIconProbe = { windows: [], tray: null };
const TrackedWindow = new Proxy(electron.BrowserWindow, {
  construct(Window, [options]) {
    const window = new Window(options);
    icons.windows.push({ title: options.title, size: options.icon?.getSize(), image: options.icon?.toDataURL() });
    return window;
  },
});
class TrackedTray extends electron.Tray {
  constructor(...args) {
    super(...args); probe.created++; icons.tray = args[0].toDataURL();
    const destroy = this.destroy.bind(this);
    this.destroy = () => { if (!this.isDestroyed()) probe.destroyed++; destroy(); };
  }
}
const entry = path.resolve(__dirname, '../../main.cjs');
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron' && parent?.filename === entry) return { ...electron, Tray: TrackedTray, BrowserWindow: TrackedWindow };
  return load.call(this, request, parent, isMain);
};
electron.app.on('will-quit', () => fs.writeFileSync(path.join(profile, 'tray-lifecycle.json'), JSON.stringify(probe)));
require(entry);
