# Papers — AI 论文阅读助手

面向 AI 方向（扩散模型等）的论文管理 + 阅读 + 对话工具：PDF 原文与 MinerU 精确解析的 Markdown 统一入库，支持全文分块检索，并内置 DeepSeek AI 助手，可直接对论文内容提问。

## 功能特性

- **论文库管理**：PDF 原文、MinerU Markdown、分块全文索引（SQLite FTS）、图片提取，全部自动维护
- **AI 论文对话**：DeepSeek tool calls，AI 可自主调用 `search_chunks` / `get_chunk` / `list_chunks` / `list_images` 等工具检索论文内容并回答
- **全局对话**：跨论文的 AI 助手页面，可搜索论文库、引用论文到对话
- **研究方向自动收录**：配置研究方向后，系统每天定时（默认 09:00 Asia/Shanghai）自动从 arXiv 搜索最新论文 → 下载 → 解析 → 入库，全程无人值守
- **AI 自动分类**：新论文按标题+摘要自动打研究方向标签，支持多方向归属与全局方向筛选
- **多源下载回退**：复用开源 [paper-search-mcp](https://github.com/openags/paper-search-mcp)（MCP 协议），下载按「源站 → CORE/EuropePMC/PMC → Unpaywall」顺序回退，官方源不可用时也能拿到 OA 全文
- **Markdown 直译**：阅读页 Markdown 标签内一键「中文」切换，直接把 MinerU 解析的 Markdown 翻译成中文（约 1 分钟/篇），公式、图片引用、引用编号原样保留
- **语义向量检索**：AI 对话新增语义检索（bge-m3 向量 + bge-reranker 重排，部署在 GPU 服务器），概念性提问与中英文跨语言检索效果显著优于关键词
- **可配置 API 端点**：设置里可自行填写 API Key 与 Base URL（默认 DeepSeek，兼容任意 OpenAI 端点），对话 / AI 分类 / MD 翻译统一使用

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
- MinerU Token（云端解析，在设置界面配置，无需安装 CLI）

### 1. 安装依赖

```bash
# 后端
cd app/server && npm install

# 前端
cd app/web && npm install
```

### 2. 配置 MinerU（PDF 解析 token）

后端直接调用 MinerU 云端精准解析 API（无需安装 CLI）。在设置界面「模型」分类下填写 MinerU Token：

```text
获取地址：https://mineru.net/apiManage/token
```

- 未配置 Token 时，论文入库 / 自动收录解析会报「请先配置 MinerU Token」
- Token 明文存于 `settings.json`（与 API Key 同模式）

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

### Markdown 中文阅读

论文阅读页的 Markdown 标签内点「中文」即可按需翻译当前论文（译文缓存在 `md-translations/`），翻译期间显示进度、可取消；之后随时切回「原文」。公式、表格、图片引用与引用编号均原样保留。

### 语义检索（AI 对话）

论文对话与全局对话都新增语义检索工具（`semantic_search_chunks` / `semantic_search_library`）：问题向量化 → 向量召回 → 交叉编码器重排。向量模型部署在 GPU 服务器（`/home/qishu/project/vector-service/`），本机 SQLite 存向量，入库自动增量嵌入。

### 自定义 API 提供商

设置界面「模型」分类支持**多 LLM Provider CRUD**：默认内置一个 DeepSeek，可新增/编辑/删除任意 OpenAI 兼容提供商（名称 + API Key + Base URL），并指定「当前使用」的提供商。全局模型（v4-flash / v4-pro）独立于提供商，统一映射为 `deepseek-v4-flash` / `deepseek-v4-pro`。

填写后可直接点「测试连接」验证（发一次最小请求，显示响应模型与延迟），确认可用再保存。AI 对话 / 分类 / MD 翻译 / 自动收录分类统一使用当前激活的提供商。

## 环境变量与配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3001` | 后端端口 |
| `PAPER_SEARCH_MCP_DISABLED` | 未设置 | `1` = 关闭 MCP，自动收录走 arXiv 直连 |
| `PAPER_SEARCH_MCP_CMD` | `uvx` | MCP server 启动命令 |
| `PAPER_SEARCH_MCP_ARGS` | `paper-search-mcp` | MCP server 启动参数 |
| `CLASSIFY_MODEL` | `v4-flash` | AI 分类所用 DeepSeek 模型 |
| `RESEARCH_ARXIV_DELAY_MS` | `3000` | 搜索方向间的礼貌间隔（ms） |
| `VECTOR_SERVICE_URL` | `http://172.16.170.184:17888` | 向量服务地址 |
| `VECTOR_SERVICE_DISABLED` | 未设置 | `1` = 关闭语义检索 |

MinerU 解析走云端精准解析 API（vlm 模型），Token 从设置界面的 `mineruToken` 读取，保存在 `settings.json`。

## 目录结构

```
Papers/
├── app/
│   ├── server/          # Express API + SQLite + MCP 客户端
│   └── web/             # React 前端
├── papers.json          # 论文元数据（标题/方向/年份/来源等）
├── research.json        # 研究方向配置（缺省时用内置默认）
├── scan-runs.json       # 自动收录运行历史（已 gitignore）
├── md-translations/     # Markdown 中文译文（已 gitignore）
├── md-translations.json # MD 翻译状态索引（已 gitignore）
├── vector-service/      # 向量服务代码（部署到 GPU 服务器）
├── rawPDF/              # PDF 原文（按 arXiv ID 命名，gitignore）
├── MD/                  # MinerU 解析的 Markdown + 图片（gitignore）
├── mineru-failed/       # 解析失败待重试的 PDF（gitignore）
└── tmp/                 # 临时/备份（gitignore）
```

## 测试

```bash
cd app/server && npm test    # 91 个用例（单元 + 集成 + API）
cd app/web && npm test       # 40 个用例（单元 + 集成）
```

## 已知限制

- **超大 PDF**（如 40MB+）：MinerU 云端处理可能超时（`download zip: context deadline exceeded`），属 MinerU 服务端限制，可稍后重试
- **arXiv 限流**：自动收录每天每查询只发一次，远低于 arXiv 3 秒/请求的礼貌限制；`searchArxiv` 已对 429/503/504 做指数退避重试
- **MCP 字段化查询**：paper-search-mcp 会把查询硬包成 `all:...`，因此 `abs:`/`ti:` 等 arXiv 字段语法直接走 arXiv API，纯关键词才走 MCP
