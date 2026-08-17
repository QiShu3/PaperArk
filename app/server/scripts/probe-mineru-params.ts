/**
 * 探测 MinerU API v4 对参数组合的接受情况（临时脚本）。
 * 用法：tsx scripts/probe-mineru-params.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { RAW_PDF_DIR } from '../src/paths.js';
import { readSettings } from '../src/settingsStore.js';

const API_BASE = 'https://mineru.net/api/v4';

async function probe(label: string, body: Record<string, unknown>): Promise<void> {
  const token = readSettings().mineruToken?.trim();
  const pdfPath = path.join(RAW_PDF_DIR, '2608.10393v1.pdf');
  const name = path.basename(pdfPath);
  const res = await fetch(`${API_BASE}/file-urls/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ files: [{ name, data_id: 'probe' }], ...body }),
  });
  const text = await res.text();
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${res.status}`);
  console.log(text.slice(0, 400));
}

async function main(): Promise<void> {
  await probe('baseline (model_version=vlm)', { model_version: 'vlm' });
  await probe('vlm + parse_mode=ocr', { model_version: 'vlm', parse_mode: 'ocr' });
  await probe('vlm + parse_mode=auto', { model_version: 'vlm', parse_mode: 'auto' });
  await probe('v2.1 + parse_mode=ocr', { model_version: 'v2.1', parse_mode: 'ocr' });
  await probe('version=vlm (field name version)', { version: 'vlm' });
  await probe('model_version=v2.0', { model_version: 'v2.0' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
