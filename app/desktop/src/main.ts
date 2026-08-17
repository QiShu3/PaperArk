import { app, BrowserWindow, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { computeRuntimeEnv, findFreePort, resolveDataRoot } from './desktopEnv.js';

// ---- 单实例锁：防双开导致 SQLite 写竞争 ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  void bootstrap();
}

let mainWindow: BrowserWindow | null = null;
let serverPort = 0;

/** 冒烟测试支持：--smoke-user-data <dir> 用临时数据目录跑真实打包产物 */
function parseSmokeUserData(): string | undefined {
  const idx = process.argv.indexOf('--smoke-user-data');
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
}

async function bootstrap(): Promise<void> {
  const smokeUserData = parseSmokeUserData();
  if (smokeUserData) {
    app.setPath('userData', path.resolve(smokeUserData));
  }
  const dataRoot = resolveDataRoot(app.getPath('userData'));

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  await app.whenReady();

  // ---- 启动内嵌 server：先注入 env（paths.ts 在模块加载时解析），再动态 import ----
  serverPort = await findFreePort();
  const runtimeEnv = computeRuntimeEnv(process.env, { dataRoot, port: serverPort });
  for (const [k, v] of Object.entries(runtimeEnv)) process.env[k] = v;

  // 静态前端目录：asar 内布局为 web-next/dist（paths.ts 的 ../../web-next/dist 在打包后会出 asar，故显式注入）
  process.env.WEB_DIST = path.join(app.getAppPath(), 'web-next', 'dist');

  // 记录端口，供冒烟脚本/调试读取
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(
    path.join(app.getPath('userData'), 'server-port.json'),
    JSON.stringify({ port: serverPort }),
  );

  // 运行时生成 server-dist（prepare-dist 拷贝），用变量路径避免 TS 静态解析
  const serverModulePath = '../server-dist/index.js';
  await import(serverModulePath);

  buildMenu(dataRoot);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'PaperArk',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  // 站外链接交给系统浏览器（arXiv / DOI / MinerU 等）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu(dataRoot: string): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'PaperArk',
      submenu: [
        { label: '打开数据目录', click: () => void shell.openPath(dataRoot) },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 退出前触发 server 的 SIGTERM 优雅关闭（close MCP 客户端 + db.close，见 server/index.ts shutdown）
app.on('before-quit', () => {
  process.emit('SIGTERM');
});
