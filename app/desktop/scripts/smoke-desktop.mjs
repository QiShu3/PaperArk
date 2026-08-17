/**
 * 冒烟测试：spawn 打包产物（portable.exe），验证内嵌 server 启动 + API 可用。
 *
 * 用法：
 *   node scripts/smoke-desktop.mjs --exe <portable.exe 路径> [--user-data <临时目录>]
 *
 * 流程：
 *   1. spawn exe（--smoke-user-data 指向临时 userData，不污染真实数据）
 *   2. 轮询 <userData>/server-port.json（主进程启动后写入）
 *   3. 轮询 GET http://127.0.0.1:<port>/api/papers 至 200（同时证明 better-sqlite3 在 Electron ABI 下加载成功）
 *   4. 结束进程（taskkill /T），清理临时目录
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..');

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
}

const exePath = arg('--exe') ?? path.join(DESKTOP_ROOT, 'dist', 'PaperArk-0.1.0.portable.exe');
const userData =
  arg('--user-data') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'paperark-smoke-'));

async function waitFor(fn, { timeoutMs = 120000, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`${label} 超时（${timeoutMs}ms）：${lastErr?.message ?? '无结果'}`);
}

if (!fs.existsSync(exePath)) {
  console.error(`[smoke] 未找到打包产物: ${exePath}`);
  console.error('[smoke] 请先运行 npm run dist:win');
  process.exit(1);
}

console.log(`[smoke] exe: ${exePath}`);
console.log(`[smoke] userData: ${userData}`);

const child = spawn(exePath, ['--smoke-user-data', userData], {
  stdio: 'ignore',
  detached: true,
});
child.unref();

try {
  // 1. 等待 server-port.json
  const portFile = path.join(userData, 'server-port.json');
  const port = await waitFor(async () => {
    if (!fs.existsSync(portFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(portFile, 'utf8')).port;
    } catch {
      return null;
    }
  }, { label: '等待 server-port.json' });

  console.log(`[smoke] server port: ${port}`);

  // 2. 等待 /api/papers 200
  const status = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/papers`);
    return res.status === 200 ? res.status : null;
  }, { label: '等待 /api/papers 200' });

  console.log(`[smoke] GET /api/papers -> ${status} ✓（server + better-sqlite3 正常）`);

  // 3. 验证静态页面可访问（server 托管 web-next/dist）
  const html = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    if (res.status !== 200) return null;
    return await res.text();
  }, { label: '等待首页 200' });
  const hasRoot = html.includes('<div id="root"') || html.includes('<script');
  console.log(`[smoke] GET / -> 200 ✓（首页 HTML 包含应用挂载点: ${hasRoot}）`);

  console.log('[smoke] ✅ 全部通过');
  process.exitCode = 0;
} catch (e) {
  console.error(`[smoke] ❌ ${e.message}`);
  process.exitCode = 1;
} finally {
  // 结束进程树
  try {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 1500));
  try {
    if (userData.startsWith(os.tmpdir())) fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
