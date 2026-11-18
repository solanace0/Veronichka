// Обгортка ПК-версії: відкриває застосунок з твого сайту в окремому вікні.
const { app, BrowserWindow, shell, Menu } = require('electron');
const { url } = require('./app-config.json');
const origin = new URL(url).origin;

function create() {
  Menu.setApplicationMenu(null);
  const w = new BrowserWindow({
    width: 460, height: 860, minWidth: 360, minHeight: 560, backgroundColor: '#000000',
    title: 'ТребаСвітло?', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.loadURL(url);
  // чужі посилання відкриваємо в браузері, а не всередині програми
  w.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, u) => { if (new URL(u).origin !== origin) { e.preventDefault(); shell.openExternal(u); } });
}
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else { app.whenReady().then(create); app.on('window-all-closed', () => app.quit()); }
