/**
 * 构建管线：编译 server + 前端，按 asar 需要的相对布局拷贝到 desktop 包。
 *
 * 布局（paths.ts 的 WEB_DIST 硬编码相对路径要求）：
 *   desktop/server-dist/     <- app/server/dist（tsc 产物）
 *   desktop/web-next/dist/   <- app/web-next/dist（vite 产物）
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.resolve(DESKTOP_ROOT, '..');

function run(cmd, cwd) {
  console.log(`[prepare] ${cmd}  (cwd=${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function copyInto(target, source) {
  console.log(`[prepare] copy ${source} -> ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

// 1. 编译 server（tsc → app/server/dist）
run('pnpm --filter @papers/server build', APP_ROOT);
// 2. 构建前端（vite → app/web-next/dist）
run('pnpm --filter @papers/web-next build', APP_ROOT);

// 3. 按桌面布局拷贝
copyInto(path.join(DESKTOP_ROOT, 'server-dist'), path.join(APP_ROOT, 'server', 'dist'));
copyInto(path.join(DESKTOP_ROOT, 'web-next', 'dist'), path.join(APP_ROOT, 'web-next', 'dist'));

console.log('[prepare] done');
