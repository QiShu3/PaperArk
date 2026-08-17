import { describe, expect, it } from 'vitest';
import net from 'node:net';
import path from 'node:path';
import { computeRuntimeEnv, findFreePort, resolveDataRoot } from '../desktopEnv.js';

describe('resolveDataRoot', () => {
  it('拼接 userData/papers-data', () => {
    expect(resolveDataRoot('C:/Users/test/AppData/Roaming/PaperArk')).toBe(
      path.join('C:/Users/test/AppData/Roaming/PaperArk', 'papers-data'),
    );
  });
});

describe('computeRuntimeEnv', () => {
  const opts = { dataRoot: 'D:/data', port: 51234 };

  it('注入桌面默认值（生产模式 + 数据目录 + 端口 + 降级开关）', () => {
    const env = computeRuntimeEnv({}, opts);
    expect(env.NODE_ENV).toBe('production');
    expect(env.PAPERS_ROOT).toBe('D:/data');
    expect(env.PORT).toBe('51234');
    expect(env.PAPER_SEARCH_MCP_DISABLED).toBe('1');
    expect(env.SCIVERSE_MCP_DISABLED).toBe('1');
    expect(env.VECTOR_SERVICE_DISABLED).toBe('1');
  });

  it('用户显式设置的 PAPERS_ROOT 不被覆盖', () => {
    const env = computeRuntimeEnv({ PAPERS_ROOT: 'E:/my-library' }, opts);
    expect(env.PAPERS_ROOT).toBe('E:/my-library');
  });

  it('用户显式启用 MCP（设为 0）时保持原值', () => {
    const env = computeRuntimeEnv({ PAPER_SEARCH_MCP_DISABLED: '0' }, opts);
    expect(env.PAPER_SEARCH_MCP_DISABLED).toBe('0');
    expect(env.SCIVERSE_MCP_DISABLED).toBe('1');
  });
});

describe('findFreePort', () => {
  it('返回一个可用的 TCP 端口（再次监听成功）', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const srv = net.createServer();
      srv.on('error', reject);
      srv.listen(port, '127.0.0.1', () => {
        srv.close(() => resolve());
      });
    });
  });
});
