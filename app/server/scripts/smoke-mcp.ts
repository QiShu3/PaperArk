import * as paperClient from '../src/paperClient.js';

const QUERY = 'attention is all you need';
const SOURCES: [string, string][] = [
  ['arxiv', QUERY],
  ['openalex', QUERY],
  ['iacr', QUERY],
];

async function run() {
  for (const [source, query] of SOURCES) {
    try {
      const started = Date.now();
      const entries = await paperClient.searchEntries(query, source, 3);
      const ms = Date.now() - started;
      console.log(`\n--- ${source} (${ms}ms, ${entries.length} entries) ---`);
      for (const e of entries) {
        console.log(`  sourceId=${e.sourceId} | arxivId=${e.arxivId ?? '-'} | doi=${e.doi ?? '-'}`);
        console.log(`    pdfUrl=${e.pdfUrl ? 'yes' : 'no'} | authors=[${e.authors.join('; ')}] | cats=[${e.categories.join('; ')}]`);
        console.log(`    title=${e.title.slice(0, 70)}`);
      }
    } catch (e) {
      console.log(`\n--- ${source} FAILED: ${e instanceof Error ? e.message : e} ---`);
    }
  }
  await paperClient.closePaperClient();
}

run().catch((e) => {
  console.error('smoke failed:', e);
  process.exit(1);
});
