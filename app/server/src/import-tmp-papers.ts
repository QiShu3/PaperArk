import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAPER_IDS, PAPER_META } from './import-meta.js';
import { extractPdfToMd } from './mineru.js';
import { readMeta, writeMeta } from './meta.js';
import { RAW_PDF_DIR } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.resolve(__dirname, '..', '..', '..', 'tmp');

async function main() {
  fs.mkdirSync(RAW_PDF_DIR, { recursive: true });

  for (const id of PAPER_IDS) {
    const meta = PAPER_META[id];
    const pdfFile = path.join(TMP_DIR, meta.file);

    if (!fs.existsSync(pdfFile)) {
      console.log(`SKIP ${id}: file not found: ${meta.file}`);
      continue;
    }

    const destPdf = path.join(RAW_PDF_DIR, `${id}.pdf`);
    if (fs.existsSync(destPdf)) {
      console.log(`SKIP ${id}: already exists`);
      continue;
    }

    console.log(`Importing ${id} (${meta.file})...`);
    fs.copyFileSync(pdfFile, destPdf);

    try {
      await extractPdfToMd(destPdf, id);
      console.log(`  MinerU OK for ${id}`);
    } catch (e) {
      console.error(`  MinerU FAILED for ${id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  const metaStore = readMeta();
  for (const id of PAPER_IDS) {
    const m = PAPER_META[id];
    const existing = metaStore[id];
    if (!existing) {
      metaStore[id] = { tags: [] };
    }
    metaStore[id] = {
      ...metaStore[id],
      venue: m.venue,
      year: m.year,
      area: m.area,
      addedAt: metaStore[id].addedAt ?? new Date().toISOString(),
    };
  }
  writeMeta(metaStore);
  console.log(`Written metadata for ${PAPER_IDS.length} papers to papers.json`);
  console.log('Done. Now run the server to rebuild the index.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
