import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(__dirname, '..');
export const APP_ROOT = path.resolve(__dirname, '..', '..');
export const PAPERS_ROOT = process.env.PAPERS_ROOT
  ? path.resolve(process.env.PAPERS_ROOT)
  : path.resolve(__dirname, '..', '..', '..');

export const RAW_PDF_DIR = path.join(PAPERS_ROOT, 'rawPDF');
export const MD_DIR = path.join(PAPERS_ROOT, 'MD');
export const IMAGES_DIR = path.join(MD_DIR, 'images');
export const MINERU_FAILED_DIR = path.join(PAPERS_ROOT, 'mineru-failed');
export const MD_TRANSLATION_DIR = path.join(PAPERS_ROOT, 'md-translations');
export const INDEX_MD = path.join(MD_DIR, 'index.md');
export const META_FILE = path.join(PAPERS_ROOT, 'papers.json');
export const DB_PATH = path.join(PAPERS_ROOT, 'papers.db');
// 桌面版（Electron）通过 env 覆盖为 asar 内真实路径；
// Web 版保持默认：src/ 编译到 server/dist 后，../../web-next/dist 即仓库内前端产物
export const WEB_DIST = process.env.WEB_DIST
  ? path.resolve(process.env.WEB_DIST)
  : path.resolve(__dirname, '..', '..', 'web-next', 'dist');
