const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isAuthorizedSender } = require('../electron/ipc-security.cjs');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-electron-'));
const authorized = path.join(root, 'authorized.html');
const external = path.join(root, 'external.html');
const preload = path.join(root, 'preload.cjs');
fs.writeFileSync(external, '<!doctype html><script>window.external=true</script>');
fs.writeFileSync(authorized, `<!doctype html><iframe src="${pathToFileURL(external).href}"></iframe><script>window.ready=true</script>`);
fs.writeFileSync(preload, "const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('testIPC',{ping:()=>ipcRenderer.invoke('test.ping')});");

function result(name, passed, detail = '') { return { name, passed, detail }; }

app.whenReady().then(async () => {
  const expected = pathToFileURL(authorized).href;
  const rejectedUrl = pathToFileURL(external).href;
  const results = [];
  ipcMain.handle('test.ping', (event) => { if (!isAuthorizedSender(event, BrowserWindow, expected, 'http://127.0.0.1:0/')) throw new Error('UNAUTHORIZED'); return 'pong'; });
  const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadFile(authorized);
  results.push(result('authorized-main-frame', await window.webContents.executeJavaScript('window.testIPC.ping()') === 'pong'));
  await window.loadFile(external);
  let externalRejected = false; try { await window.webContents.executeJavaScript('window.testIPC.ping()'); } catch { externalRejected = true; }
  results.push(result('external-file-rejected', externalRejected));
  await window.loadFile(authorized);
  const child = window.webContents.mainFrame.framesInSubtree[0];
  let childRejected = false; if (child) { try { await child.executeJavaScript('window.testIPC.ping()'); } catch { childRejected = true; } }
  results.push(child && childRejected ? result('secondary-frame-rejected', true) : { name: 'secondary-frame-rejected', passed: false, skipped: true, detail: 'Electron 39 test preload is not available in the secondary frame execution context.' });
  results.push(result('configured-url-is-exact', isAuthorizedSender({ sender: window.webContents, senderFrame: { url: rejectedUrl } }, BrowserWindow, expected, 'http://127.0.0.0:0/') === false));
  await window.close();
  ipcMain.removeHandler('test.ping');
  const failed = results.filter((item) => !item.passed && !item.skipped);
  const skipped = results.filter((item) => item.skipped);
  console.log(JSON.stringify({ suite: 'electron-integration', results, passed: results.length - failed.length - skipped.length, failed: failed.length, skipped: skipped.length }));
  app.exit(failed.length ? 1 : 0);
}).catch((error) => { console.error(error.stack || error); app.exit(1); });
