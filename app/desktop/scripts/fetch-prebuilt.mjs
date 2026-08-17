/**
 * 获取与当前 Electron ABI 匹配的 better-sqlite3 预编译二进制。
 *
 * 背景：better-sqlite3 是 V8 API 原生模块，必须与 Electron 的 ABI 精确匹配；
 * 本机无 VS 工具链无法 node-gyp 编译，因此从官方 GitHub Releases 下载
 * better-sqlite3 为各 Electron 版本发布的 prebuild（v12.11.1 覆盖 ABI 121-146）。
 * 若当前 Electron ABI 没有对应 prebuild，脚本会明确报错（提示降级 Electron）。
 *
 * 用法：node scripts/fetch-prebuilt.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..');
const SQLITE_VERSION = '12.11.1';
const SQLITE_DIR = path.join(DESKTOP_ROOT, 'node_modules', 'better-sqlite3');
const NODE_FILE = path.join(SQLITE_DIR, 'build', 'Release', 'better_sqlite3.node');
const EL_EXE = path.join(DESKTOP_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${(r.stderr || '').slice(0, 500)}`);
  }
  return r.stdout ?? '';
}

// 1. 读取 Electron ABI
if (!fs.existsSync(EL_EXE)) {
  console.error('[fetch-prebuilt] 未找到 electron 二进制，请先安装 electron（npm install）');
  process.exit(1);
}
const abi = sh(EL_EXE, ['-p', 'process.versions.modules'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
}).trim();
console.log(`[fetch-prebuilt] Electron ABI = ${abi}`);

// 2. 已有匹配二进制则跳过
if (fs.existsSync(NODE_FILE) && fs.statSync(NODE_FILE).size > 1000) {
  console.log('[fetch-prebuilt] better_sqlite3.node 已存在，跳过下载');
  process.exit(0);
}

// 3. 下载并解压 prebuild
const asset = `better-sqlite3-v${SQLITE_VERSION}-electron-v${abi}-win32-x64.tar.gz`;
const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${SQLITE_VERSION}/${asset}`;
const tmp = path.join(os.tmpdir(), `better-sqlite3-${Date.now()}.tar.gz`);

console.log(`[fetch-prebuilt] 下载 ${asset}`);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const curlArgs = ['-L', '--fail', '-sS'];
if (proxy) curlArgs.push('--proxy', proxy);
curlArgs.push('-o', tmp, url);
try {
  sh('curl.exe', curlArgs);
} catch (e) {
  fs.rmSync(tmp, { force: true });
  console.error(`[fetch-prebuilt] 下载失败：${e.message}`);
  console.error('[fetch-prebuilt] 当前 Electron ABI 可能没有官方 prebuild，请降级 Electron 到有 prebuild 的版本（见 electron-builder.yml 注释）');
  process.exit(1);
}

fs.mkdirSync(path.join(SQLITE_DIR, 'build'), { recursive: true });
sh('tar', ['-xzf', tmp, '-C', SQLITE_DIR]);
fs.rmSync(tmp, { force: true });

if (!fs.existsSync(NODE_FILE) || fs.statSync(NODE_FILE).size <= 1000) {
  console.error('[fetch-prebuilt] 解压后未找到有效 better_sqlite3.node');
  process.exit(1);
}
console.log(`[fetch-prebuilt] 完成：${NODE_FILE} (${fs.statSync(NODE_FILE).size} bytes)`);
