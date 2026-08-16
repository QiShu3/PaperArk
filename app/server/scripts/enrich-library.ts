/**
 * 全库元数据补全（一次性脚本）：
 *   直接调用 metaEnrich.enrichLibrary()，跑完即退出。
 *   用于手动批量补全（等价于 POST /api/meta/enrich），不依赖长驻服务器进程。
 *
 * 用法：pnpm tsx scripts/enrich-library.ts
 */
import { enrichLibrary, getEnrichStatus } from '../src/metaEnrich.js';
import { closeSciverseClient } from '../src/sciverseClient.js';

async function main(): Promise<void> {
  console.log('开始全库元数据补全...');
  const started = Date.now();
  await enrichLibrary();
  const status = getEnrichStatus();
  console.log(
    `完成：共 ${status.total} 篇，补全 ${status.matched}，跳过 ${status.skipped}，失败 ${status.failed}，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  if (status.errors.length > 0) {
    console.log('失败明细：');
    for (const err of status.errors) console.log(`  - ${err}`);
  }
  await closeSciverseClient();
  process.exit(0); // 显式退出，避免 MCP 子进程拖住事件循环
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
