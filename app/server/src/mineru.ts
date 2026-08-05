import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import { MD_DIR, IMAGES_DIR } from './paths.js';

function runMineru(pdfPath: string, outDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['extract', pdfPath, '-o', outDir, '-f', 'md'];
    // npm 全局安装只生成 .cmd/.ps1 垫片（无 .exe），Node spawn 默认 shell:false
    // 在 Windows 上无法直接执行，必须由 cmd.exe 解析；用单字符串命令避免 args+shell 的注入警告
    const child =
      process.platform === 'win32'
        ? spawn(`mineru-open-api ${args.map((a) => `"${a}"`).join(' ')}`, {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        : spawn('mineru-open-api', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`mineru exited with code ${code}: ${err || out}`))
    );
  });
}

export async function extractPdfToMd(pdfPath: string, id: string): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mineru-'));
  try {
    await runMineru(pdfPath, tmp);

    const mds = fg.sync('**/*.md', { cwd: tmp, absolute: true });
    if (mds.length === 0) {
      throw new Error('MinerU 未生成任何 Markdown 输出');
    }
    const mdPath = mds[0];
    const mdContent = fs.readFileSync(mdPath, 'utf-8');

    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const mdDir = path.dirname(mdPath);
    const imgs = fg.sync('**/*.{jpg,jpeg,png,gif,webp,svg}', { cwd: mdDir, absolute: true });
    for (const img of imgs) {
      fs.copyFileSync(img, path.join(IMAGES_DIR, path.basename(img)));
    }

    fs.writeFileSync(path.join(MD_DIR, `${id}.md`), mdContent, 'utf-8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
