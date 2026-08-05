# Papers — AI 论文阅读助手

面向 AI 方向（扩散模型等）的论文管理 + 阅读 + 对话工具：PDF 原文与 MinerU 精确解析的 Markdown 统一入库，支持全文分块检索，并内置 DeepSeek AI 助手，可直接对论文内容提问。

## 功能特性

- **论文库管理**：PDF 原文、MinerU Markdown、分块全文索引（SQLite FTS）、图片提取，全部自动维护
- **AI 论文对话**：DeepSeek tool calls，AI 可自主调用 `search_chunks` / `get_chunk` / `list_chunks` / `list_images` 等工具检索论文内容并回答
- **全局对话**：跨论文的 AI 助手页面，可搜索论文库、引用论文到对话
- **研究方向自动收录**：配置研究方向后，系统每天定时（默认 09:00 Asia/Shanghai）自动从 arXiv 搜索最新论文 → 下载 → 解析 → 入库，全程无人值守
- **AI 自动分类**：新论文按标题+摘要自动打研究方向标签，支持多方向归属与全局方向筛选
- **多源下载回退**：复用开源 [paper-search-mcp](https://github.com/openags/paper-search-mcp)（MCP 协议），下载按「源站 → CORE/EuropePMC/PMC → Unpaywall」顺序回退，官方源不可用时也能拿到 OA 全文

## 架构

```
app/
├── server/   # Express API + SQLite（分块/全文索引/会话），tsx 运行
└── web/      # React + Vite 前端（列表/阅读/对话/研究方向管理）
```

```
User → ChatPanel (React)
         └─ POST /api/chat (SSE) → DeepSeek API
              └─ while hasToolCalls: 本地执行 tool handlers → 追加结果

cron / POST /api/research/check → research 流水线
  ├─ 搜索：字段化查询走 arXiv API；纯关键词走 paper-search-mcp（MCP）
  ├─ 去重：库内已有 / 解析失败过的自动跳过
  ├─ 下载：MCP download_with_fallback（Sci-Hub 关闭）→ 失败降级 arXiv 直连
  ├─ 解析：MinerU extract 精确解析 → Markdown → 分块 → SQLite
  ├─ 入库：papers.json meta + AI 分类
  └─ 记录：scan-runs.json（每次运行状态与失败原因）
```

## 快速开始

### 0. 环境要求

- Node.js ≥ 18（推荐 22）
- Python ≥ 3.9 + [uv](https://docs.astral.sh/uv/)（运行 paper-search-mcp）
- MinerU CLI（`mineru-open-api`，npm 全局安装）

### 1. 安装依赖

```bash
# 后端
cd app/server && npm install

# 前端
cd app/web && npm install
```

### 2. 安装 MinerU（PDF 解析，需 token）

```bash
npm install -g mineru-open-api
mineru-open-api auth        # 在 https://mineru.net/apiManage/token 申请后配置
mineru-open-api auth --verify
```

### 3. 安装 paper-search-mcp（自动收录的搜索/下载，可选但有回退链）

```bash
uv tool install paper-search-mcp
```

可选：配置 OA 回退渠道凭据（`~/.config/paper-search-mcp/.env`）：

```ini
PAPER_SEARCH_MCP_UNPAYWALL_EMAIL=你的邮箱        # unpaywall.org 免费申请
PAPER_SEARCH_MCP_CORE_API_KEY=你的CORE密钥       # core.ac.uk 免费申请
```

### 4. 启动

```bash
# 后端 API（默认 3001）
cd app/server && npm run dev

# 前端（默认 5173，代理 /api、/rawPDF、/MD 到 3001）
cd app/web && npm run dev
```

打开 <http://localhost:5173>，在「设置」中填入 DeepSeek API key 即可开始对话。

## 使用

### 手动上传

论文列表页直接上传 PDF，系统自动完成 MinerU 解析、分块索引、后台 AI 分类。

### 研究方向自动收录

`/research` 页面管理研究方向（名称 + arXiv 查询词 + 开关 + 单方向上限）。系统按 `research.json` 配置的 cron（默认每天 09:00）自动运行，也可点击「立即检查」手动触发。

配置示例（`research.json`，位于项目根目录）：

```json
{
  "schedule": { "cron": "0 9 * * *", "timezone": "Asia/Shanghai" },
  "maxPerRun": 5,
  "directions": [
    { "name": "基于扩散模型的对抗攻击", "query": "abs:\"diffusion model\" AND abs:adversarial AND abs:attack", "enabled": true }
  ]
}
```

自动收录的论文标记 `source: arxiv-auto`，列表页带「自动收录」徽标，可按研究方向筛选。每次运行写入 `scan-runs.json`（保留 50 条），下载失败下次自动重试，解析失败的 PDF 移入 `mineru-failed/`，移除前自动跳过。

### AI 对话

- 论文阅读页：针对当前论文提问（工具：分块搜索/取段/列图等）
- `/chat` 全局对话：跨论文提问，右侧面板可搜索并引用论文

## 环境变量与配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3001` | 后端端口 |
| `PAPER_SEARCH_MCP_DISABLED` | 未设置 | `1` = 关闭 MCP，自动收录走 arXiv 直连 |
| `PAPER_SEARCH_MCP_CMD` | `uvx` | MCP server 启动命令 |
| `PAPER_SEARCH_MCP_ARGS` | `paper-search-mcp` | MCP server 启动参数 |
| `CLASSIFY_MODEL` | `v4-flash` | AI 分类所用 DeepSeek 模型 |
| `RESEARCH_ARXIV_DELAY_MS` | `3000` | 搜索方向间的礼貌间隔（ms） |

MinerU token 读取顺序：`--token` 参数 > `MINERU_TOKEN` 环境变量 > `~/.mineru/config.yaml`。

## 目录结构

```
Papers/
├── app/
│   ├── server/          # Express API + SQLite + MCP 客户端
│   └── web/             # React 前端
├── papers.json          # 论文元数据（标题/方向/年份/来源等）
├── research.json        # 研究方向配置（缺省时用内置默认）
├── scan-runs.json       # 自动收录运行历史（已 gitignore）
├── rawPDF/              # PDF 原文（按 arXiv ID 命名，gitignore）
├── MD/                  # MinerU 解析的 Markdown + 图片（gitignore）
├── mineru-failed/       # 解析失败待重试的 PDF（gitignore）
└── tmp/                 # 临时/备份（gitignore）
```

## 测试

```bash
cd app/server && npm test    # 70 个用例（单元 + 集成 + API）
cd app/web && npm test       # 23 个用例（单元 + 集成）
```

## 已知限制

- **超大 PDF**（如 40MB+）：MinerU 云端处理可能超时（`download zip: context deadline exceeded`），属 MinerU 服务端限制，可稍后重试
- **arXiv 限流**：自动收录每天每查询只发一次，远低于 arXiv 3 秒/请求的礼貌限制；`searchArxiv` 已对 429/503/504 做指数退避重试
- **MCP 字段化查询**：paper-search-mcp 会把查询硬包成 `all:...`，因此 `abs:`/`ti:` 等 arXiv 字段语法直接走 arXiv API，纯关键词才走 MCP
