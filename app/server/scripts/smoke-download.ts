import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as paperClient from '../src/paperClient.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-dl-'));

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 4).toString('latin1') === '%PDF';
}

async function run() {
  // 1) pdf_url 直连（OpenAlex 等元数据源主路径）
  try {
    const buf = await paperClient.fetchPdfUrl(
      'https://arxiv.org/pdf/2105.02723v1',
    );
    console.log(`fetchPdfUrl arxiv: ${isPdf(buf) ? 'OK (is %PDF)' : 'FAIL (not PDF)'}`);
  } catch (e) {
    console.log(`fetchPdfUrl arxiv FAILED: ${e instanceof Error ? e.message : e}`);
  }

  // 2) download_with_fallback（原生源，paper_id 传 sourceId）
  for (const [source, paperId] of [['arxiv', '2105.02723v1'], ['iacr', '2026/840']] as const) {
    try {
      const p = await paperClient.downloadWithFallback({
        source,
        paperId,
        doi: '',
        title: '',
        savePath: dir,
      });
      const ok = p && fs.existsSync(p) && isPdf(fs.readFileSync(p));
      console.log(`downloadWithFallback ${source}/${paperId}: ${ok ? 'OK (' + path.basename(p) + ')' : 'FAIL: ' + String(p).slice(0, 120)}`);
    } catch (e) {
      console.log(`downloadWithFallback ${source}/${paperId} FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  await paperClient.closePaperClient();
  fs.rmSync(dir, { recursive: true, force: true });
}

run().catch((e) => {
  console.error('smoke failed:', e);
  process.exit(1);
});
