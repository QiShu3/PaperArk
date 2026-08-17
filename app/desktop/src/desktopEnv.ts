import net from 'node:net';
import path from 'node:path';

/**
 * 桌面运行时环境配置 —— 纯函数，便于单元测试。
 */

export interface RuntimeEnv {
  PAPERS_ROOT: string;
  PORT: string;
  NODE_ENV: 'production';
  PAPER_SEARCH_MCP_DISABLED: string;
  SCIVERSE_MCP_DISABLED: string;
  VECTOR_SERVICE_DISABLED: string;
}

/** 数据根目录：userData/papers-data（论文库、数据库、翻译缓存等全部落在这里） */
export function resolveDataRoot(userData: string): string {
  return path.join(userData, 'papers-data');
}

/**
 * 计算注入给 server 进程的环境变量。
 * 用户显式设置过的（overrides 中非空）保持原值，否则给桌面默认值：
 * - NODE_ENV=production：触发 server 静态托管前端（index.ts）
 * - MCP/向量服务在桌面环境默认降级（无 uv/Python/npx/GPU 服务），
 *   论文解析（MinerU 云端 API）与对话（DeepSeek）不受影响。
 */
export function computeRuntimeEnv(
  overrides: NodeJS.ProcessEnv,
  opts: { dataRoot: string; port: number },
): RuntimeEnv {
  const pick = (name: string, fallback: string): string => {
    const v = overrides[name];
    return v && v.trim() !== '' ? v : fallback;
  };
  return {
    PAPERS_ROOT: pick('PAPERS_ROOT', opts.dataRoot),
    PORT: String(opts.port),
    NODE_ENV: 'production',
    PAPER_SEARCH_MCP_DISABLED: pick('PAPER_SEARCH_MCP_DISABLED', '1'),
    SCIVERSE_MCP_DISABLED: pick('SCIVERSE_MCP_DISABLED', '1'),
    VECTOR_SERVICE_DISABLED: pick('VECTOR_SERVICE_DISABLED', '1'),
  };
}

/** 探测 127.0.0.1 上的空闲端口（避免 3001 被占用） */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
