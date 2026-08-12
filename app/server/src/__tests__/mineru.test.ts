import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yazl from 'yazl';

let tempDir: string;
let mineru: typeof import('../mineru.js');
let settingsStore: typeof import('../settingsStore.js');

const PDF_BYTES = Buffer.from('%PDF-1.4 fake pdf content');

function zipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, content] of Object.entries(files)) {
      zip.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content), name);
    }
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'mineru-test-'));
  process.env.PAPERS_ROOT = tempDir;
  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  settingsStore = await import('../settingsStore.js');
  mineru = await import('../mineru.js');
});

afterAll(async () => {
  vi.unstubAllGlobals();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('mineru extractPdfToMd', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    settingsStore.writeSettings({ model: 'v4-flash', mineruToken: 'm-token' });
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  function stubSuccessFlow() {
    const md = '# Title\n\n![](images/fig1.png)\n\nbody text';
    const zipPromise = zipBuffer({
      'full.md': md,
      'images/fig1.png': Buffer.from('PNG'),
    });
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            data: {
              batch_id: 'batch-1',
              file_urls: ['https://oss.example/upload'],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockImplementation((url: string) => {
        if (url.includes('extract-results')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                code: 0,
                msg: 'ok',
                data: {
                  extract_result: [
                    { file_name: 'test.pdf', state: 'done', full_zip_url: 'https://cdn.example/result.zip' },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        if (url === 'https://cdn.example/result.zip') {
          return zipPromise.then((buf) => new Response(buf, { status: 200 }));
        }
        return Promise.resolve(new Response('not found', { status: 404 }));
      });
  }

  it('extracts a pdf via MinerU API and writes markdown + images', async () => {
    stubSuccessFlow();
    const pdfPath = join(tempDir, 'raw.pdf');
    writeFileSync(pdfPath, PDF_BYTES);

    await mineru.extractPdfToMd(pdfPath, 'test-paper');

    expect(existsSync(join(tempDir, 'MD', 'test-paper.md'))).toBe(true);
    expect(readFileSync(join(tempDir, 'MD', 'test-paper.md'), 'utf-8')).toContain('# Title');
    expect(existsSync(join(tempDir, 'MD', 'images', 'fig1.png'))).toBe(true);

    const postCall = mockFetch.mock.calls[0];
    expect(postCall[0]).toBe('https://mineru.net/api/v4/file-urls/batch');
    const postInit = postCall[1] as RequestInit;
    expect((postInit.headers as Record<string, string>).Authorization).toBe('Bearer m-token');
    expect((postInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(postInit.body as string);
    expect(body.model_version).toBe('vlm');
    expect(body.files[0]).toMatchObject({ name: 'raw.pdf', data_id: 'test-paper' });

    const putCall = mockFetch.mock.calls[1];
    expect(putCall[0]).toBe('https://oss.example/upload');
    expect((putCall[1] as RequestInit).method).toBe('PUT');
  });

  it('throws when no MinerU token is configured', async () => {
    settingsStore.writeSettings({ mineruToken: '' });
    const pdfPath = join(tempDir, 'raw.pdf');
    writeFileSync(pdfPath, PDF_BYTES);
    await expect(mineru.extractPdfToMd(pdfPath, 'x')).rejects.toThrow(/MinerU Token/);
  });

  it('throws a clear error when the task fails with err_msg', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 0, msg: 'ok', data: { batch_id: 'b', file_urls: ['https://oss.example/u'] } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            data: { extract_result: [{ state: 'failed', err_msg: 'file too large' }] },
          }),
          { status: 200 },
        ),
      );
    const pdfPath = join(tempDir, 'raw.pdf');
    writeFileSync(pdfPath, PDF_BYTES);
    await expect(mineru.extractPdfToMd(pdfPath, 'x')).rejects.toThrow(/file too large/);
  });

  it('rejects when the pdf exceeds the 200MB limit', async () => {
    const pdfPath = join(tempDir, 'big.pdf');
    writeFileSync(pdfPath, Buffer.alloc(201 * 1024 * 1024));
    await expect(mineru.extractPdfToMd(pdfPath, 'x')).rejects.toThrow(/200MB/);
  });
});
