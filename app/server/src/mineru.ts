import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import yauzl from 'yauzl';
import { MD_DIR, IMAGES_DIR } from './paths.js';
import { readSettings } from './settingsStore.js';

const API_BASE = 'https://mineru.net/api/v4';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60_000;
const FILE_LIMIT = 200 * 1024 * 1024;
const FILE_LIMIT_MSG = '文件超过 MinerU 限制（200MB / 200 页），请拆分后重试';

function mineruToken(): string {
  const token = readSettings().mineruToken?.trim();
  if (!token) {
    throw new Error('未配置 MinerU Token，请在设置中填写（https://mineru.net/apiManage/token）');
  }
  return token;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), ...init });
  if (!res.ok) throw new Error(`MinerU API 请求失败 (HTTP ${res.status})`);
  return (await res.json()) as T;
}

interface ApiEnvelope {
  code: number;
  msg?: string;
  data?: Record<string, unknown>;
}

function expectOk(body: ApiEnvelope, action: string): void {
  if (!body || body.code !== 0) {
    throw new Error(`MinerU ${action}失败：${body?.msg ?? '未知错误'}`);
  }
}

/** 申请上传链接并上传文件，返回 batch_id。 */
async function submitPdf(pdfPath: string, dataId: string): Promise<string> {
  const stat = fs.statSync(pdfPath);
  if (stat.size > FILE_LIMIT) throw new Error(FILE_LIMIT_MSG);
  const token = mineruToken();
  const name = path.basename(pdfPath);

  const body = await httpJson<ApiEnvelope>(`${API_BASE}/file-urls/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      files: [{ name, data_id: dataId }],
      model_version: 'vlm',
    }),
  });
  expectOk(body, '提交');
  const data = (body.data ?? {}) as { batch_id?: string; file_urls?: string[] };
  const batchId = data.batch_id;
  const uploadUrl = data.file_urls?.[0];
  if (!batchId || !uploadUrl) throw new Error('MinerU 提交失败：未返回上传链接');

  const buf = fs.readFileSync(pdfPath);
  const putRes = await fetch(uploadUrl, { method: 'PUT', body: buf });
  if (!putRes.ok) throw new Error(`MinerU 文件上传失败 (HTTP ${putRes.status})`);
  return batchId;
}

/** 轮询批量任务结果，返回 done 后 zip 下载链接。 */
async function pollBatchResult(batchId: string): Promise<string> {
  const token = mineruToken();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const body = await httpJson<ApiEnvelope>(`${API_BASE}/extract-results/batch/${batchId}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    expectOk(body, '查询');
    const result = (body.data?.extract_result as Record<string, unknown>[] | undefined)?.[0];
    if (!result) throw new Error('MinerU 查询结果为空');
    const state = typeof result.state === 'string' ? result.state : '';
    if (state === 'done') {
      const url = typeof result.full_zip_url === 'string' ? result.full_zip_url : '';
      if (url) return url;
    } else if (state === 'failed') {
      const err = typeof result.err_msg === 'string' ? result.err_msg : '未知错误';
      throw new Error(`MinerU 解析失败：${err}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('MinerU 解析超时');
}

/** 解压 zip 到指定目录，保留相对目录结构（防御路径穿越）。 */
function unzip(zipPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr) return reject(openErr);
      if (!zipfile) return reject(new Error('MinerU 结果解压失败'));
      let count = 0;
      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        const raw = entry.fileName.replace(/\\/g, '/');
        const safe = raw.split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
        if (entry.fileName.endsWith('/') || !safe) {
          zipfile.readEntry();
          return;
        }
        count++;
        zipfile.openReadStream(entry, (readErr, stream) => {
          if (readErr) {
            zipfile.close();
            return reject(readErr);
          }
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', (e) => {
            zipfile.close();
            reject(e);
          });
          stream.on('end', () => {
            const dest = path.join(outDir, safe);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, Buffer.concat(chunks));
            zipfile.readEntry();
          });
        });
      });
      zipfile.on('end', () => {
        if (count === 0) {
          zipfile.close();
          return reject(new Error('MinerU 结果为空'));
        }
        zipfile.close();
        resolve();
      });
      zipfile.on('error', reject);
    });
  });
}

async function downloadZip(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`MinerU 结果下载失败 (HTTP ${res.status})`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

export async function extractPdfToMd(pdfPath: string, id: string): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mineru-'));
  try {
    const batchId = await submitPdf(pdfPath, id);
    const zipUrl = await pollBatchResult(batchId);

    const zipPath = path.join(tmp, 'result.zip');
    await downloadZip(zipUrl, zipPath);

    const extractDir = path.join(tmp, 'out');
    fs.mkdirSync(extractDir, { recursive: true });
    await unzip(zipPath, extractDir);

    const mdPath = path.join(extractDir, 'full.md');
    if (!fs.existsSync(mdPath)) {
      throw new Error('MinerU 结果中未找到 full.md');
    }
    const mdContent = fs.readFileSync(mdPath, 'utf-8');

    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const imgs = fg.sync('images/**/*.{jpg,jpeg,png,gif,webp,svg}', { cwd: extractDir, absolute: true });
    for (const img of imgs) {
      fs.copyFileSync(img, path.join(IMAGES_DIR, path.basename(img)));
    }

    fs.mkdirSync(MD_DIR, { recursive: true });
    fs.writeFileSync(path.join(MD_DIR, `${id}.md`), mdContent, 'utf-8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
