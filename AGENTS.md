# Tools & Tests 开发记录

## 项目概览

为 Papers 论文阅读助手添加 DeepSeek Tool Calls 能力，支持 AI 自主调用工具检索论文信息。

### 架构图

```
User → ChatPanel (React)
         ├─ sendMessage 执行循环
         │    └─ while hasToolCalls:
         │         ├─ POST /api/chat (SSE) → DeepSeek API
         │         ├─ 流式解析 content + tool_calls delta
         │         ├─ 本地执行 tool handlers
         │         └─ 追加 tool 结果 → 循环
         │
         ├─ ChatContext (状态管理)
         │    ├─ appendMessage / updateLastAssistant
         │    ├─ updateLastAssistantToolCalls (delta 合并)
         │    └─ persistSession (SQLite 持久化)
         │
         └─ tools.ts (8 工具 + 注册表)
              ├─ search_chunks / get_chunk / list_chunks
              ├─ get_current_chunk
              ├─ list_images
              ├─ search_papers / get_paper_chunk / list_paper_chunks
              └─ createToolHandlers(paperId, getCurrentChunk)
```

## 测试结果

### Phase 0 — 测试基础设施

| 事项 | 状态 |
|---|---|
| vitest 安装 (server + web) | ✅ |
| supertest 安装 (server) | ✅ |
| @testing-library/react, jsdom, msw (web) | ✅ |
| vitest.config.ts × 2 | ✅ |
| test scripts: `test` / `test:watch` | ✅ |

### Phase 1 — 后端改造

**单元测试 (7 tests)**

| 文件 | 测试 | 状态 |
|---|---|---|
| `chunker.test.ts` | 提取标题 | ✅ |
| | 提取 Abstract (bold 格式) | ✅ |
| | 提取 Abstract (bold-with-colon 格式) | ✅ |
| | 按 ## 分段 | ✅ |
| | 多级标题嵌入父段 | ✅ |
| | 无 Abstract 的 Markdown | ✅ |
| | 无标题默认 Untitled | ✅ |
| | char_count 跟踪 | ✅ |

**集成测试 (3 tests)**

| 文件 | 测试 | 状态 |
|---|---|---|
| `chatStore.test.ts` | tool_calls 保存/读取往返 | ✅ |
| | 事务替换旧数据 | ✅ |
| | clearChat 删除 | ✅ |

**API 测试 (9 tests)**

| 文件 | 测试 | 状态 |
|---|---|---|
| `chat.api.test.ts` | POST /api/chat 无 apiKey → 400 | ✅ |
| | SSE content delta 流式返回 | ✅ |
| | SSE tool_calls delta 流式返回 | ✅ |
| | tools 参数转发到 DeepSeek | ✅ |
| | content + tool_calls 同帧处理 | ✅ |
| | DeepSeek 错误 → 转发状态码 | ✅ |
| | GET /api/papers/:id/images | ✅ |
| | GET /api/papers/:id/images 404 | ✅ |
| | GET /api/papers/:id/chunks?q= query | ✅ |

### Phase 2 — 前端基础

**集成测试 (6 tests)**

| 文件 | 测试 | 状态 |
|---|---|---|
| `ChatContext.test.tsx` | appendMessage 添加用户消息 | ✅ |
| | updateLastAssistant 更新内容 | ✅ |
| | updateLastAssistantToolCalls 合并 delta | ✅ |
| | loadHistory 解析 tool_calls JSON | ✅ |
| | persistSession 保存 tool_calls | ✅ |
| | clearSession 删除本地+服务端 | ✅ |

### Phase 3 — 工具系统

**单元测试 (6 tests)**

| 文件 | 测试 | 状态 |
|---|---|---|
| `tools.test.ts` | 8 个工具定义 | ✅ |
| | 每个工具 type: 'function' | ✅ |
| | 工具名称完整性 | ✅ |
| | parameters.type 为 'object' | ✅ |
| | required 参数声明 | ✅ |
| | 无参数工具的 required: [] | ✅ |

## 最终统计

| 层级 | 测试文件 | 用例数 | 状态 |
|---|---|---|---|
| 后端单元 | 1 (chunker) | 8 | ✅ |
| 后端集成 | 1 (chatStore) | 3 | ✅ |
| 后端 API | 1 (chat.api) | 9 | ✅ |
| 前端集成 | 1 (ChatContext) | 6 | ✅ |
| 前端单元 | 1 (tools) | 6 | ✅ |
| **总计** | **5 文件** | **32** | **✅ All Pass** |

## 已实现的工具

| 工具 | 参数 | 功能 |
|---|---|---|
| `search_chunks` | query: string | FTS 搜索当前论文分段 |
| `get_chunk` | target: string (标题名/索引) | 获取指定段完整内容 |
| `get_current_chunk` | (无) | 获取用户当前浏览的段 |
| `list_chunks` | (无) | 列出所有段标题 |
| `list_images` | (无) | 列出所有图片路径 |
| `search_papers` | query: string | 搜索论文库 |
| `get_paper_chunk` | paper_id, target | 获取任意论文指定段 |
| `list_paper_chunks` | paper_id | 列出任意论文所有段 |

## 修改文件清单

```
新增:
  app/server/src/__tests__/chunker.test.ts
  app/server/src/__tests__/chatStore.test.ts
  app/server/src/__tests__/chat.api.test.ts
  app/server/vitest.config.ts
  app/web/src/tools.ts
  app/web/src/__tests__/ChatContext.test.tsx
  app/web/src/__tests__/tools.test.ts
  app/web/src/test-setup.ts
  app/web/vitest.config.ts
  AGENTS.md

修改:
  app/server/package.json          (test scripts, vitest, supertest)
  app/server/src/db.ts             (chat_messages 加 3 列 + migration)
  app/server/src/chatStore.ts      (SaveMessage 接口 + tool_calls 序列化)
  app/server/src/chat.ts           (转发 tools, 解析 tool_calls delta)
  app/server/src/chunker.ts        (ABSTRACT_RE 修复)
  app/server/src/store.ts          (新增 getRawMarkdown)
  app/server/src/index.ts          (createApp(), GET /api/papers/:id/images)
  app/web/package.json             (test scripts, vitest, testing-library)
  app/web/src/types.ts             (ToolCall, ToolCallDelta, ChatMessage 扩展)
  app/web/src/api.ts               (StreamChunk 扩展, tools 参数, getImages)
  app/web/src/context/ChatContext.tsx (tool_calls 处理, updateLastAssistantToolCalls)
  app/web/src/components/ChatPanel.tsx (工具循环, resolveImage, rehype-raw, system prompt)
   app/web/src/pages/PaperReader.tsx    (quoteTexts 数组, onQuotesClear)
   app/web/src/components/MarkdownView.tsx (浮出操作栏「添加到上下文」)

---

## 全局 Agent (Phase 4)

### 功能

新增全局对话页面 `/chat`，支持跨论文的 AI 助手：

- **三栏布局**（参考 Codex）：左栏可收起会话列表，中间聊天栏，右栏可展开论文库面板
- **全局工具集**：search_papers, list_papers, get_paper_chunk, list_paper_chunk
- **会话隔离**：使用 `paper_id = '__global__'` 独立于论文会话
- **论文引用插入**：右栏点击论文插入 `[标题](id)` 到输入框

### 架构

```
/chat → GlobalChat (三栏布局)
  ├─ SessionSidebar (可收起)
  │    ├─ 会话列表 / 切换 / 删除
  │    └─ 新建会话 / 设置按钮
  ├─ ChatPanel (mode="global")
  │    ├─ buildGlobalSystemPrompt (无预设论文上下文)
  │    ├─ GLOBAL_TOOL_DEFINITIONS (4 工具)
  │    └─ createGlobalToolHandlers (无需 paperId)
  └─ ToolSidebar (默认收起)
       ├─ 论文搜索
       ├─ 论文列表 (标题/ID/标签/年份)
       └─ 点击插入引用
```

### ChatPanel 泛化

```tsx
interface Props {
  mode?: 'paper' | 'global';  // 新增
  paperId?: string;            // 改为可选
  paperTitle?: string;         // 改为可选
  paperContent?: string;       // 改为可选
  inputValue?: string;         // 新增：受控输入
  onInputChange?: (v) => void; // 新增：受控输入
  // quoteTexts 等改为可选
}
```

### 新增/修改文件

```
新增:
  app/web/src/tools/globalTools.ts        (GLOBAL_TOOL_DEFINITIONS + createGlobalToolHandlers)
  app/web/src/components/SessionSidebar.tsx (左栏：会话列表)
  app/web/src/components/ToolSidebar.tsx    (右栏：论文库面板)
  app/web/src/pages/GlobalChat.tsx          (三栏布局容器)

修改:
  app/web/src/App.tsx                       (+ /chat 路由)
  app/web/src/components/ChatPanel.tsx       (泛化: mode prop, 受控输入)
  app/web/src/pages/PaperList.tsx            (+「全局对话」入口按钮)
  app/server/src/index.ts                    (insertPaper('__global__'), 保护删除)
```

### 测试

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 29 tests ✅ |
| 前端单元 + 集成 | 15 tests ✅ |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |

---

## Phase 9 — 语义向量检索（2026-08-08）

### 功能

为 AI agent 增加高质量语义检索：关键词 FTS 之外，新增「bge-m3 向量召回 + bge-reranker-v2-m3 交叉编码器重排」链路，解决概念性提问与中英文跨语言检索：

- **服务器推理**：模型部署在 GPU 服务器（`/home/qishu/project/vector-service/`，2×RTX 3090），本机通过 HTTP 调用（`/embed` + `/rerank`），空闲 15 分钟自动释放显存
- **存储**：SQLite chunks 表新增 `embedding`（fp32 BLOB）与 `lexical`（稀疏权重 JSON）列；全库 1243 个 chunk 约 50 秒嵌入完成，精确暴力余弦（当前规模毫秒级，召回质量优于 ANN）
- **检索流程**：问题向量化 → 向量余弦 top-50 → 远程 reranker 精排 → top-k；支持论文内与全库两种范围
- **Agent 工具**：论文对话新增 `semantic_search_chunks`，全局对话新增 `semantic_search_library`，系统提示词指引 agent 概念性/跨语言问题优先语义检索
- **自动维护**：手动上传 / 自动收录入库后自动增量嵌入
- **可开关**：`VECTOR_SERVICE_DISABLED=1` 关闭；`VECTOR_SERVICE_URL` 配置服务地址（默认 `http://172.16.170.184:17888`）

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/vector/embed-all` | 全库批量嵌入（202，异步） |
| GET | `/api/vector/status` | 嵌入状态（enabled/running/current/total/embedded） |
| GET | `/api/papers/:id/semantic-search?q=&top_k=` | 论文内语义检索 |
| GET | `/api/search/semantic?q=&top_k=` | 全库语义检索 |

### 实测（2026-08-08）

- 中文问题「攻击者如何判断某个样本是否在模型的训练集里？」FTS 返回空，语义检索命中 Threat Model / Empirical Privacy Evaluation 等关键段
- 全库检索「扩散模型对抗攻击的常见方法有哪些？」跨论文命中 T2I 攻击、对抗采样等段落（重排分数 0.98+）
- 服务器部署踩坑：hf-mirror 对 `.DS_Store` 403（跳过无用文件）、HF Xet 协议不支持（`HF_HUB_DISABLE_XET=1`）、transformers 5.x 不兼容（固定 4.49 + dtype→torch_dtype 兼容补丁）

### 修改文件清单

```
新增:
  vector-service/app.py                        (服务器 FastAPI：/embed + /rerank + 空闲卸载)
  vector-service/requirements.txt / README.md
  vector-service/prototype_compare.py          (原型对比脚本)
  app/server/src/vectorStore.ts                (嵌入/语义检索客户端 + SQLite 向量存取)
  app/server/src/__tests__/vectorStore.test.ts (7 用例)

修改:
  app/server/src/db.ts                         (chunks + embedding/lexical 列 + 查询函数)
  app/server/src/index.ts                      (+ vector 路由 + 上传后自动嵌入)
  app/server/src/research.ts                   (自动收录后自动嵌入)
  app/web/src/types.ts / api.ts                (+ SemanticHit/EmbedStatus + 语义检索接口)
  app/web/src/tools.ts / tools/globalTools.ts  (+ semantic_search_chunks / semantic_search_library)
  app/web/src/components/ChatPanel.tsx         (系统提示词指引语义检索)
  app/web/src/__tests__/tools.test.ts          (8 → 9 工具)
  AGENTS.md / README.md
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 91 tests ✅（原 84 + 新增 7） |
| 前端单元 + 集成 | 40 tests ✅ |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |

---

## Phase 8 — Markdown 直接翻译（2026-08-07）

### 功能

新增 **MD 直接翻译**（取代 Phase 7 的 BabelDOC PDF 翻译，后者已移除）：复用 MinerU 解析出的 Markdown，按段落分批调 LLM 翻译，速度约 1 分钟/篇：

- **阅读页切换**：Markdown 标签内新增「原文 / 中文」切换，中文视图按需触发翻译并缓存
- **格式保护**：系统提示词要求保留 Markdown 语法、LaTeX 公式（`$...$`/`$$...$$`）、图片引用、代码块、引用编号
- **按段分批**：按标题分段、按字符数分批（默认 2800 字/批），不在公式/代码块中间断开
- **缓存**：译文存 `md-translations/<id>.zh.md`，状态存 `md-translations.json`；重复打开不重翻
- **健壮性**：空响应/429/5xx 自动重试 3 次（退避）；关闭思考（`thinking: disabled`）提速省 token，可用 `MD_TRANSLATE_THINKING=enabled` 关闭该参数
- **单飞**：同一时间只翻译一篇，可取消/重试

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/papers/:id/translate-md` | 启动翻译（202；done 直接返回） |
| GET | `/api/papers/:id/translate-md` | 状态 + 进度 + 译文内容 |
| POST | `/api/papers/:id/translate-md/cancel` | 取消 |

### 实测（2026-08-07）

- `2605.15246v1` MD 全篇翻译 **85 秒**，输出 18.6k 字符；32 个行内公式、3 个块级公式、134 个引用编号完整保留
- 中转站曾瞬时返回空内容，重试机制兜底后成功

### 修改文件清单

```
新增:
  app/server/src/translateMd.ts              (MD 翻译：分段/分批/重试/缓存/状态)
  app/server/src/__tests__/translateMd.test.ts (10 用例)
  app/web/src/components/MdTranslationView.tsx (阅读页原文/中文切换)
  app/web/src/__tests__/MdTranslationView.test.tsx (5 用例)

修改:
  app/server/src/paths.ts                    (+ MD_TRANSLATION_DIR)
  app/server/src/index.ts                    (+ translate-md 路由 + 删除清理)
  app/web/src/types.ts / api.ts              (+ MdTranslation 类型与接口)
  app/web/src/pages/PaperReader.tsx          (Markdown 标签接入 MdTranslationView)
  app/server/src/index.ts / research.ts      (移除 BabelDOC PDF 翻译相关代码)
  app/web/src/pages/PaperReader.tsx / ResearchPage.tsx (移除 PDF（中文）标签与翻译队列面板)
  .gitignore                                 (+ md-translations/、md-translations.json)
  AGENTS.md / README.md
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 84 tests ✅（124 - BabelDOC 40） |
| 前端单元 + 集成 | 40 tests ✅（50 - BabelDOC 10） |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |

---

## 研究方向自动收录 (Phase 5)

### 功能

新增按研究方向定时自动收录 arXiv 论文的能力：

- **研究方向配置**：`research.json`（PAPERS_ROOT 下），含定时 cron（默认每天 09:00 Asia/Shanghai）、全局单方向上限（默认 5）、方向列表（名称 + arXiv 查询词 + 开关 + 可选单方向上限）
- **自动入库**：服务运行时按 cron 触发；每个启用的方向调用 arXiv API（sortBy=submittedDate 倒序），与库内 ID（归一化去掉 vN）去重后，自动下载 PDF → 复用 MinerU 解析链路入库
- **状态标记**：自动收录论文 meta 写入 `source: 'arxiv-auto'`、`area: 方向名`、`year: arXiv 提交年份`；列表页显示「自动收录」徽标并支持筛选
- **失败处理**：下载失败记 `download_failed`；MinerU 解析失败把 PDF 移入 `mineru-failed/` 并记 `parse_failed`，后续运行自动跳过直到手动移除
- **运行历史**：每次运行写入 `scan-runs.json`（保留 50 条），含每篇论文的状态；`POST /api/research/check` 手动触发，单飞防重入

### 架构

```
cron / POST /api/research/check → research.startCheck() (单飞)
  └─ research.runCheck
       ├─ searchArxiv(query)        # export.arxiv.org/api/query, 3s 间隔
       ├─ 去重 (库内 ID + mineru-failed)
       ├─ downloadPdf(arxivId)      # arxiv.org/pdf/<id>
       └─ createPaper(source='arxiv-auto') → MinerU 解析入库

/research 页面 (React)
  ├─ 方向增删改 / 启用停用
  ├─ 立即检查 + 轮询运行状态
  └─ 运行历史 (状态徽标 + 失败原因)
```

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/research/directions` | 配置（schedule + maxPerRun + 方向列表） |
| POST | `/api/research/directions` | 新增方向（名称唯一） |
| PUT | `/api/research/directions/:name` | 更新查询词/开关/上限（名称不可改） |
| DELETE | `/api/research/directions/:name` | 删除方向 |
| POST | `/api/research/check` | 手动触发检查（202 + runId，异步） |
| GET | `/api/research/status` | 运行中状态或最近一次运行 |
| GET | `/api/research/runs` | 运行历史 |

### 修改文件清单

```
新增:
  app/server/src/researchConfig.ts   (research.json 读写/校验/方向 CRUD)
  app/server/src/arxiv.ts            (arXiv API 查询 + Atom XML 解析)
  app/server/src/research.ts         (checkNow 流水线 + 运行历史)
  app/server/src/__tests__/research.test.ts (13 用例)
  app/web/src/pages/ResearchPage.tsx (/research 管理页)
  app/web/src/__tests__/ResearchPage.test.tsx (4 用例)

修改:
  app/server/package.json             (+ node-cron, fast-xml-parser; better-sqlite3 锁 12.11.1)
  app/server/src/paths.ts             (+ MINERU_FAILED_DIR)
  app/server/src/meta.ts / store.ts   (+ source 字段, updatePaper 保留 source)
  app/server/src/index.ts             (+ research 路由 + cron 注册)
  app/server/src/__tests__/chat.api.test.ts (+ research API 测试 4 用例)
  app/web/src/types.ts / api.ts       (+ research 类型与接口)
  app/web/src/App.tsx                 (+ /research 路由)
  app/web/src/pages/PaperList.tsx     (+ 自动收录徽标/筛选 + 入口按钮)
  app/web/src/pages/PaperReader.tsx   (+ 自动收录徽标)
```

### 测试

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 46 tests ✅ |
| 前端单元 + 集成 | 19 tests ✅ |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |

### 扩展：AI 分类 + 全局方向筛选

研究方向升级为全局筛选维度：

- **AI 分类**：`classify.ts` 复用 settings 里的 DeepSeek key（模型默认 `v4-flash`，可用 `CLASSIFY_MODEL` 覆盖），根据标题 + 摘要判断论文属于哪些方向；`POST /api/research/classify` 批量分类已有论文（跳过已分类），`GET /api/research/classify-status` 查看进度
- **自动分类**：自动收录的新论文入库时用 arXiv 摘要即时分类，失败则兜底到抓取它的方向；手动上传论文也会后台异步分类
- **数据模型**：`papers.json` 每篇新增 `directions: string[]`（可属多方向，`Paper`/meta/store 全链路透传）
- **全局切换**：`DirectionContext` 保存当前选择（`global` 或具体方向名，localStorage 持久化）；论文列表页左上角下拉切换
- **作用范围**：列表、搜索、阅读页徽标、全局对话工具（`search_papers`/`list_papers`）与系统提示词全部跟随当前方向

新增/修改文件：

```
新增:
  app/server/src/classify.ts
  app/server/src/__tests__/classify.test.ts   (12 用例)
  app/web/src/context/DirectionContext.tsx
  app/web/src/__tests__/DirectionContext.test.tsx (3 用例)

修改:
  app/server/src/meta.ts / store.ts   (+ directions 字段)
  app/server/src/research.ts          (入库后 AI 分类)
  app/server/src/index.ts             (+ classify 路由 + 上传后分类)
  app/web/src/types.ts / api.ts       (+ directions, ClassifyStatus)
  app/web/src/App.tsx                 (+ DirectionProvider)
  app/web/src/pages/PaperList.tsx     (+ 方向切换器 + 过滤)
  app/web/src/pages/ResearchPage.tsx  (+ 分类入口与进度)
  app/web/src/components/ChatPanel.tsx (+ useDirection, 系统提示词)
  app/web/src/tools.ts / tools/globalTools.ts (工具按方向过滤)
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 59 tests ✅ |
| 前端单元 + 集成 | 23 tests ✅ |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |

---

## Phase 6 — 复用 paper-search-mcp（MCP 客户端）

### 功能

自动收录的搜索/下载改为复用开源 [paper-search-mcp](https://github.com/openags/paper-search-mcp)（MIT，PyPI 独立包），服务器作为 **MCP 客户端** 通过 stdio 拉起 `uvx paper-search-mcp`：

- **搜索**：`search_papers` 工具（固定 `sources: 'arxiv'`），自带 UA/重试/退避
- **下载**：`download_with_fallback` 工具（源站 → OpenAIRE/CORE/EuropePMC/PMC → Unpaywall），**Sci-Hub 显式关闭**
- **降级**：`PAPER_SEARCH_MCP_DISABLED=1` 或 MCP 进程/调用失败时，自动回退到原有 arXiv API 直连（`arxiv.ts`），流水线不中断
- **防护**：下载后仍保留 `%PDF` magic 校验；方向间 3 秒延迟保留（MCP 的 arXiv 连接器无成功间隔限速）
- **字段化查询绕过 MCP**：paper-search-mcp 会把查询硬包成 `all:...`，`abs:...`/`ti:...` 等 arXiv 原生字段语法会被拼坏（实测返回 0 篇且不报错）。`research.ts` 检测字段前缀（`/^(ti|au|abs|co|jr|cat|rn|id|all):/i`）直接走 arXiv API；纯关键词查询才走 MCP

### 架构

```
research.ts (cron / POST /api/research/check)
  ├─ searchForDirection()
  │    ├─ paperClient.searchEntries()  → MCP search_papers
  │    └─ 失败 → searchArxiv() 直连
  ├─ downloadPdfForEntry()
  │    ├─ paperClient.downloadWithFallback() → MCP download_with_fallback
  │    └─ 失败 → downloadPdf() 直连
  └─ createPaper → MinerU（不变）

paperClient.ts（单例 + 懒启动 + 断线重建）
  └─ @modelcontextprotocol/sdk Client + StdioClientTransport
       └─ uvx paper-search-mcp
```

### 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PAPER_SEARCH_MCP_DISABLED` | 未设置 | `1` = 关闭 MCP 走 arXiv 直连 |
| `PAPER_SEARCH_MCP_CMD` | `uvx` | MCP server 启动命令 |
| `PAPER_SEARCH_MCP_ARGS` | `paper-search-mcp` | 启动参数（空格分隔） |

可透传给子进程的可选 key（Unpaywall 邮箱、CORE key 等）后续按需添加。

### 修改文件清单

```
新增:
  app/server/src/paperClient.ts              (MCP 客户端：searchEntries / downloadWithFallback / closePaperClient)
  app/server/src/__tests__/paperClient.test.ts (6 用例：参数、structuredContent、Sci-Hub 关闭、失败/缺文件抛错)

修改:
  app/server/package.json                     (+ @modelcontextprotocol/sdk)
  app/server/src/arxiv.ts                     (ArxivEntry + doi?: string; searchArxiv 429/503/504 指数退避重试)
  app/server/src/research.ts                  (searchForDirection / downloadPdfForEntry + MCP 降级)
  app/server/src/index.ts                     (SIGINT/SIGTERM 时关闭 MCP 客户端)
  app/server/src/__tests__/research.test.ts   (+ 3 用例：MCP 路径、搜索降级、下载降级)
  AGENTS.md
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 70 tests ✅（原 59 + 新增 11） |
| 前端单元 + 集成 | 23 tests ✅ |
| TypeScript 编译 | ✅ |

### 真实联调记录（2026-08-04）

- MCP 层已实测：`search_papers` 真实搜到 5 篇（plain query）；`download_with_fallback` 真实下载 38MB PDF（`%PDF` 校验通过）
- 踩到 arXiv 边缘层（Google/Varnish）按 IP+查询串的 429：测试期间对同一精确查询重复请求触发；触发后同一 IP 短暂窗口内所有 arXiv 查询均 429。**生产每天 cron 每查询只发一次，不会触发**；`searchArxiv` 已加 429/503/504 指数退避重试兜底
- `structuredContent` 实测形状为 `{ result: { ... } }`，paperClient 已做解包

### 补充修复（2026-08-05，全链路联调发现）

- **MinerU Windows spawn 失败**：npm 全局安装只生成 `.cmd/.ps1` 垫片（无 `.exe`），Node `spawn` 默认 `shell:false` 找不到 → `mineru.ts` 在 Windows 下改用单字符串命令 + `shell:true`（避免 args+shell 的注入警告）
- **SQLite 外键崩溃**：`chunks.paper_id` 外键指向 `papers` 表，但 `createPaper` 写 chunks 前从未插入 `papers` 行（此前 MinerU 一直坏着，从未走到这步）→ `store.ts` 在 `saveChunks` 前补 `insertPaper`（幂等 UPSERT）
- **半成品孤儿**：解析/入库任一步失败会残留 rawPDF/MD，而 `listIds()` 以文件为准，导致论文以残缺状态出现在库里 → `createPaper` 事务化，失败时清理 rawPDF/MD/SQLite 行再抛错
- **运行数据不入库**：`scan-runs.json` 加入 `.gitignore`（运行时历史，保留 50 条）
- **全链路实测**：13 篇论文经「搜索 → MCP 下载 → MinerU 解析 → 分块索引 → meta → AI 分类兜底」完整入库；唯一遗留 `2607.13336`（43MB）因 MinerU 云端处理超时（`download zip: context deadline exceeded`）反复失败，属云 API 大文件限制

---

## Phase 7 — BabelDOC 版式保留 PDF 翻译（2026-08-05，2026-08-07 已移除）

> **已移除**：Phase 8 引入 Markdown 直译后，BabelDOC PDF 翻译功能整体下线（后端 translate.ts、PDF（中文）标签、/research 翻译队列面板、全部相关 API 均已删除）。以下保留作为历史记录。

### 功能

论文入库即自动翻译，阅读页新增「PDF（中文）」标签查看中文版 PDF。复用本地安装的 [BabelDOC](https://github.com/funstory-ai/BabelDOC)（版式保留的中英对照 PDF 翻译库）：

- **入库自动翻译**：手动上传 / 自动收录入库成功后，后台自动把论文加入翻译队列（FIFO，同一时间只跑一篇，BabelDOC 峰值内存 ~2GB）；已翻译过的论文自动跳过
- **队列持久化**：排队中的论文写 `translations.json`（status `queued`），服务器重启后 `initPendingQueue()` 自动恢复未执行的任务
- **PDF（中文）标签**：阅读页标签扩展为「Markdown / PDF / PDF（中文）/ 分块」，优先展示纯中文 PDF（mono），无 mono 时回退双语 dual
- **状态可见**：翻译中/排队中显示进度并可取消；失败/未翻译时给出原因和「重新翻译」按钮（手动重试走 POST 立即启动）
- **批量补翻**：/research 页「论文翻译队列」面板（`POST /api/translate/all`），把库中所有有 PDF 且未翻译的论文一次性入队，逐篇慢慢翻译
- **进度展示**：/research 面板轮询 `GET /api/translate/status`，显示进行中的论文、阶段（解析 PDF/翻译段落/排版…）、已运行时长、百分比进度条，以及排队列表和各状态计数
- **停止 / 重试**：`POST /api/translate/stop` 取消当前任务并清空队列（排队中记 cancelled）；`POST /api/translate/retry` 把 failed/cancelled 的论文重新入队
- **复用 DeepSeek**：直接用 settings 里的 API key，模型映射与 chat 一致（`v4-flash → deepseek-v4-flash`）
- **可配置 Base URL**：settings.json 增加 `baseUrl`（默认 `https://api.deepseek.com/v1`），设置对话框可填任意 OpenAI 兼容端点；chat / classify / translate 三个调用点统一读取
- **连接测试**：设置对话框「测试连接」按钮（`POST /api/chat/test`），用表单当前值（无需保存）发一次 `max_tokens=5` 的最小请求，返回模型名与延迟
- **可禁用**：`BABELDOC_DISABLED=1` 或找不到可执行文件时，自动翻译记 failed 但不阻塞入库

### 架构

```
PaperReader → 内容标签: Markdown | PDF | PDF（中文）| 分块
  └─ TranslatedPdfView (React)
  ├─ GET  /api/papers/:id/translate    状态（3s 轮询）
  ├─ POST /api/papers/:id/translate    手动重试（立即启动，忙时 409）
  ├─ POST /api/papers/:id/translate/cancel
  └─ /translations/<paperId>/*.pdf     express.static 下载

入库（手动上传 POST /api/papers / research 自动收录）
  └─ translate.scheduleTranslation(paperId)  → FIFO 队列
       └─ runJob: spawn babeldoc --files rawPDF/<id>.pdf -o translations/<id>/
            --openai --openai-base-url https://api.deepseek.com/v1
            --openai-model deepseek-v4-flash --openai-api-key <settings.apiKey>
            --watermark-output-mode no_watermark
          env: USERPROFILE/HOME → .babeldoc-home（BabelDOC 硬编码 Path.home()/.cache/babeldoc）
```

### Windows 实测结论（2026-08-05）

- 6 页论文全篇翻译约 303s，峰值内存 ~2GB，输出 dual + mono 各 6 页
- **必须把 `USERPROFILE` 指到可写目录**（BabelDOC 把缓存硬编码到 `Path.home()/.cache/babeldoc`，沙箱/受限账号下启动即崩）
- 首次运行需一次性下载资源（`babeldoc --warmup`，约 300MB：字体 + doclayout 版式模型），缓存在 `.babeldoc-home`
- 文本层存在 CJK 兼容字形（`了`/`器`），渲染正常但复制出的字符非标准 Unicode（BabelDOC 上游行为）

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `BABELDOC_DISABLED` | 未设置 | `1` = 关闭翻译功能 |
| `BABELDOC_BIN` | `<PAPERS_ROOT>/.babeldoc-env/Scripts/babeldoc(.exe)` | BabelDOC 可执行文件 |
| `BABELDOC_HOME` | `<PAPERS_ROOT>/.babeldoc-home` | 缓存/资源目录（写入 USERPROFILE/HOME） |
| `BABELDOC_TIMEOUT_MS` | `7200000` | 单篇翻译超时（毫秒） |

### 修改文件清单

```
新增:
  app/server/src/translate.ts             (翻译服务：配置/队列/spawn/状态/取消/清理)
  app/server/src/__tests__/translate.test.ts (24 用例)
  app/web/src/components/TranslatedPdfView.tsx (PDF（中文）标签内容：状态/轮询/下载/重试)
  app/web/src/__tests__/TranslatedPdfView.test.tsx (6 用例)

修改:
  app/server/src/paths.ts                 (+ TRANSLATION_DIR)
  app/server/src/index.ts                 (+ /translations 静态 + translate 路由 + 入库自动调度 + 启动恢复队列 + 删除清理 + 关闭钩子)
  app/server/src/research.ts              (自动收录入库后 scheduleTranslation)
  app/server/src/settingsStore.ts         (+ baseUrl 字段，默认 https://api.deepseek.com/v1)
  app/server/src/chat.ts / classify.ts    (读取 settings.baseUrl 拼 chat/completions)
  app/web/src/types.ts                    (+ TranslationRecord/Outputs/Options)
  app/web/src/api.ts                      (+ startTranslate/getTranslateStatus/cancelTranslate)
  app/web/src/pages/PaperReader.tsx       (标签切换加入 PDF（中文）)
  app/web/src/pages/PaperList.tsx         (设置入口；批量翻译已移到 /research)
  app/web/src/pages/ResearchPage.tsx      (+「论文翻译队列」面板：进度/停止/重试)
  app/web/src/components/SettingsDialog.tsx (+ API Base URL 输入框)
  .gitignore                              (+ translations/、.babeldoc-*、.uv-*)
  AGENTS.md / README.md
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 111 tests ✅（原 70 + 新增 41） |
| 前端单元 + 集成 | 45 tests ✅（原 31 + 新增 14） |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |

---

## Phase 10 — 前端整体迁移到 Ant Design X + antd v6（2026-08-08）

### 功能

新增 `app/web-next` 前端（pnpm 包 `@papers/web-next`），将旧 `app/web`（Tailwind v4 + Radix）整体重构为 **Ant Design X + antd v6**，彻底移除 Tailwind：

- **技术栈**：React 19.2.8 + antd 6.5.4 + @ant-design/x 2.9 + @ant-design/x-markdown 2.9 + @ant-design/icons 6（全部原生支持 React 19，无需 v5-patch）
- **聊天界面**：`Bubble.List`（user/assistant placement + Avatar）、`Sender` + `Suggestion`（输入区）、`ThoughtChain`（工具调用链，成功/失败样式）、`Conversations`（会话列表）、`Welcome`/`Prompts`（空态/快捷指令）
- **Markdown**：`@ant-design/x-markdown` + 官方 `Latex` 插件（marked + KaTeX，支持 `$`/`$$`/`\(\)`/`\[\]`），替代 react-markdown；`lib/markdown.tsx` 封装统一入口（图片路径 `/MD/images/` 重写）
- **数据流**：保留原 `ChatContext` + `sendMessage` 循环（方案 A，业务逻辑拷贝复用，未采用 useXChat）
- **样式**：antd Design Token（`theme.ts` 明暗两套）+ CSS Modules，无 Tailwind；toast 用 antd `App.useApp().message`
- **页面**：PaperList / PaperReader / GlobalChat / ResearchPage 全部重写为 antd 组件

### 切换

- `server/src/paths.ts`：`WEB_DIST` → `web-next/dist`
- 根 `package.json`：`dev`/`build`/`typecheck` 默认走 web-next；旧 web 保留为 `dev:web`/`build:web`/`typecheck:web`
- dev 端口：web-next 为 **5174**（proxy /api /rawPDF /MD → 3001）

### 修改文件清单

```
新增:
  app/web-next/  (package.json / vite.config.ts / vitest.config.ts / tsconfig.json / index.html)
  app/web-next/src/main.tsx / theme.ts / index.css / test-setup.ts / App.tsx
  app/web-next/src/lib/markdown.tsx  (XMarkdown 封装 + Latex 插件 + resolveImage)
  app/web-next/src/lib/settings.ts   (getSettings/loadSettings/saveSettings)
  app/web-next/src/pages/{PaperList,PaperReader,GlobalChat,ResearchPage}.tsx
  app/web-next/src/components/{ChatPanel,SessionSidebar,SettingsDialog,UploadDialog,
    TagEditor,MdTranslationView,MarkdownView,ChunkView,MdEditor,PdfViewer,ErrorBoundary}.tsx
  app/web-next/src/__tests__/{PaperList,ResearchPage,SettingsDialog,MdTranslationView}.test.tsx

拷贝复用（纯业务逻辑）:
  app/web-next/src/api.ts / types.ts / tools.ts / tools/globalTools.ts
  app/web-next/src/context/{ChatContext,DirectionContext}.tsx
  app/web-next/src/__tests__/{tools,ChatContext,DirectionContext}.test.ts(x)

修改:
  app/pnpm-workspace.yaml           (+ web-next)
  app/package.json                  (dev/build/typecheck → web-next；旧 web 保留为 :web)
  app/server/src/paths.ts           (WEB_DIST → web-next/dist)
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| web-next 单元 + 集成 | 41 tests ✅（3 拷贝 + 4 重写） |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅（JS gzip ~530KB，含 antd 全量） |
| 旧 web 回归 | 未动，可随时回退 |

---

## Phase 11 — 自动搜索多源化 + 来源/DOI 筛选（2026-08-11）

### 功能

自动收录从「仅 arXiv 单源」扩展为 **arXiv + OpenAlex + IACR** 三源（`AVAILABLE_SOURCES` 白名单，源可在 `sources.ts` 常量表扩展）；每个方向可配**每源独立查询词**；跨源用 **DOI 优先去重**；元数据源（OpenAlex 等无原生托管）做发现 + **DOI 回填**；列表页新增**来源 / 有 DOI** 筛选维度。

### 关键设计

- **源常量**（`sources.ts`）：`SOURCE_INFO`（label + download 能力）、`AVAILABLE_SOURCES`、`PaperEntry` 类型、`sanitizeStorageId`（arxiv 保留版本化 ID，其余 `source-sourceId` 替换 `/` 等非法字符——IACR paper_id 含斜杠如 `2026/1331`）
- **配置模型**（`researchConfig.ts`）：方向 `query` → `queries: {source, query}[]`；旧配置（单 `query`）读时自动迁移为 `[{source:'arxiv', query}]`；`GET /api/research/directions` 返回 `availableSources`
- **检索链路**（`paperClient.ts` + `research.ts`）：
  - `searchEntries(query, source, maxResults)` 单源调用 MCP `search_papers`；字段化 arXiv 查询（`abs:` 等）仍直连 arXiv API
  - 下载优先级：条目自带 `pdf_url` 直连（`fetchPdfUrl`，%PDF 校验，OpenAlex 主路径）→ MCP `download_with_fallback`（源站→OA 仓库→Unpaywall，Sci-Hub 关闭）→ arXiv 直连降级
  - 去重：`dedupeKeysOf` 生成 DOI / `source:sourceId`（arxiv 去版本）/ 标题归一化三路候选 key；命中已有论文时用搜索到的 DOI **回填**库内 `meta.doi`
- **数据模型**：`meta.ts`/`store.ts` 新增 `sourceId`、`doi` 字段全链路透传；`meta.source` 记 `${source}-auto`（如 `openalex-auto`）；存量 arXiv 论文惰性按 `arxiv:<normalizeArxivId(id)>` 参与去重
- **前端**：ResearchPage 方向弹窗改「源查询条目」列表（源下拉 + 查询词 + 增删）；PaperList 新增来源标签（动态聚合）与「有 DOI」筛选，「自动收录」判定改为 `source.endsWith('-auto')`
- **冒烟脚本**（`server/scripts/smoke-mcp.ts` / `smoke-download.ts`，npm `smoke:src` / `smoke:dl`）：真实拉起 `uvx paper-search-mcp` 验证五源搜索字段解析与下载链路

### 联调实测（2026-08-11，真实 MCP 0.1.4）

- **arxiv**：3 篇正常，无 DOI（预期），paper_id 带版本号
- **openalex**：命中「Attention Is All You Need」，DOI + 部分 `pdf_url`，`paper_id=W2626778328`
- **iacr**：`paper_id=2026/1331` **确认含斜杠**（sanitize 后 `iacr-2026-1331`）
- **semantic**：直连 API `HTTP 429`（匿名限流）→ **需配 `PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY` 才稳定，第一版未纳入白名单**
- **zenodo**：MCP 0.1.4 上游 bug（`published_date` isoformat）→ 暂缓
- **下载**：本机 IP 被 Cloudflare 拦截（IACR/部分 OA 直链 403），属环境问题；生产不同 IP 可能不受影响

### 修改文件清单

```
新增:
  app/server/src/sources.ts                (源常量 / PaperEntry / sanitizeStorageId)
  app/server/scripts/smoke-mcp.ts          (搜索冒烟，真实 MCP)
  app/server/scripts/smoke-download.ts     (下载冒烟)

修改:
  app/server/src/arxiv.ts                  (+ arxivEntryToPaper 适配)
  app/server/src/paperClient.ts            (searchEntries 单源 / fetchPdfUrl / hitToPaperEntry 分号解析)
  app/server/src/researchConfig.ts         (queries 模型 + 迁移 + availableSources)
  app/server/src/research.ts               (多源流水线 / 三路去重 / DOI 回填 / 下载优先级)
  app/server/src/store.ts / meta.ts        (+ sourceId / doi 字段)
  app/server/src/index.ts                  (GET directions 返回 availableSources)
  app/server/package.json                  (+ smoke:src / smoke:dl)
  app/web-next/src/types.ts / api.ts       (ResearchQuery / Paper.doi+sourceId / 接口参数)
  app/web-next/src/pages/ResearchPage.tsx  (方向弹窗多源条目 + 运行历史来源徽标)
  app/web-next/src/pages/PaperList.tsx     (来源 / 有 DOI 筛选 + 来源徽标)
  app/server/src/__tests__/research.test.ts   (多源 / DOI 去重 / 回填 / 迁移)
  app/server/src/__tests__/paperClient.test.ts(单源参数 / 分号解析 / fetchPdfUrl)
  app/server/src/__tests__/chat.api.test.ts   (queries / sourceId / doi 断言)
  app/web-next/src/__tests__/ResearchPage.test.tsx / PaperList.test.tsx
  AGENTS.md
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 103 tests ✅（原 91 + 新增 12） |
| 前端单元 + 集成 | 42 tests ✅（原 40 + 新增 2） |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |
| 真实 MCP 冒烟（搜索） | ✅（arxiv/openalex/iacr 解析正确） |
| 真实 MCP 冒烟（下载） | ✅ arxiv；iacr/OA 403 属环境问题如实上报 |

---

## Phase 12 — 数据源配置中心（2026-08-11）

### 功能

在**设置界面**（SettingsDialog，配 API Key 的那个弹窗）新增「数据源」区块，可视化配置自动搜索使用的论文源：

- **全源可见**：所有已知源（含默认停用的 Semantic Scholar / Zenodo）列出，标注下载能力（可下载 PDF / 仅元数据）、说明、默认启停状态
- **启停开关**：每源 Switch 独立开关；自动搜索运行时自动跳过禁用的源；方向弹窗的源下拉只显示已启用的源
- **每源 API Key**：支持 key 的源（如 Semantic Scholar）行内嵌输入框；留空保存 = 保持原值，已配置时显示「已配置」灰标；key 明文存 `settings.json`（与 apiKey 同模式），启动 MCP 子进程时透传为 `PAPER_SEARCH_MCP_*` 环境变量（`StdioClientTransport.env` 需与 `process.env` 合并，因其是整体替换语义）
- **迁移**：旧 `AVAILABLE_SOURCES` 白名单 → 每源 `defaultEnabled`；旧 `settings.json`（无 sources）读时自动补默认

### 关键改动

- `sources.ts`：`SOURCE_INFO` 扩展 `note/keyEnv/keyLabel/defaultEnabled`；`AVAILABLE_SOURCES` 移除，新增 `ALL_KNOWN_SOURCES`
- `settingsStore.ts`：`AppSettings.sources: Record<source, {enabled, key}>` + 默认合并 + `sourceViews()`（不含 key 明文）
- `paperClient.ts`：`serverParams()` 读 settings 映射 key → env 透传（懒连接，下次搜索连接生效）
- `research.ts`：跑方向 queries 前跳过 `settings.sources[source].enabled === false` 的源
- `index.ts`：`GET/PUT /api/settings` 返回/接收 `sources: SourceView[]`
- `researchConfig.ts`：`availableSources()` 改为返回已启用的源
- 前端：`Settings` 类型加 `sources`；SettingsDialog 数据源区块（Switch + 能力 Tag + note + key 输入）

### 修改文件清单

```
新增:
  app/server/src/__tests__/settingsStore.test.ts    (默认合并/读写/无明文 key，5 用例)

修改:
  app/server/src/sources.ts         (SOURCE_INFO 扩展 / ALL_KNOWN_SOURCES)
  app/server/src/settingsStore.ts   (sources 合并读写 / sourceViews)
  app/server/src/paperClient.ts     (serverParams env 透传)
  app/server/src/research.ts        (跳过禁用源)
  app/server/src/researchConfig.ts  (availableSources → 启用源)
  app/server/src/index.ts           (settings API 返回 sources)
  app/web-next/src/types.ts         (Settings.sources / SourceSetting)
  app/web-next/src/api.ts           (getSettings/saveSettings 类型)
  app/web-next/src/lib/settings.ts  (默认 sources)
  app/web-next/src/components/SettingsDialog.tsx (数据源区块)
  app/web-next/src/__tests__/SettingsDialog.test.tsx (数据源渲染/启停+key 提交)
  app/server/src/__tests__/chat.api.test.ts  (settings/sources API)
  AGENTS.md
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 110 tests ✅（原 103 + 新增 7） |
| 前端单元 + 集成 | 44 tests ✅（原 42 + 新增 2） |
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |

---

## 补充修复 — arXiv 429 限流退避（2026-08-12）

### 背景

自动收录的 `scan-runs.json` 显示 08-11 / 08-12 连续两次 cron 运行全部失败（`arXiv API 请求失败 (HTTP 429)`）。根因：方向查询是 fielded 语法（`abs:"..." AND ...`），绕过 MCP 直连 arXiv API；`searchArxiv` 对 429 只重试 3 次、退避仅 3s/6s，而 arXiv 边缘层按 IP+查询串限流，窗口常持续几分钟，重试期内全部撞墙。

### 修改

`app/server/src/arxiv.ts`（`searchArxiv` 重试逻辑重写）：

- **429 与 503/504 分治**：429 单独重试 4 次，503/504 只重试 3 次
- **429 长退避**：默认 30s/60s/90s 指数退避 + 0~5s 随机抖动（避免多查询同步重试）；503/504 保持 3s/6s 短退避
- **Retry-After 优先**：有该头时按它退避（封顶 300s），否则才用指数退避
- **env 可调**（便于测试/调优）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `ARXIV_RATE_LIMIT_BASE_MS` | `30000` | 429 退避基数 |
| `ARXIV_RATE_LIMIT_JITTER_MS` | `5000` | 429 抖动上限（0 关闭） |
| `ARXIV_TRANSIENT_BASE_MS` | `3000` | 503/504 退避基数 |

`app/server/src/__tests__/research.test.ts`：`searchArxiv retry` 组新增 4 个用例（重试成功 / Retry-After 优先 / 429 耗尽 4 次放弃 / 503+504 混合重试后放弃），原有「重试 429 后成功」保留，测试通过 env 注入小基数避免真实退避等待。

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 113 tests ✅（原 110 + 新增 3） |
| TypeScript 编译 | ✅ |

> 注：`research.json` 尚未创建（走默认配置，仅 arXiv 一个方向）；多个 `tsx watch` 实例中仅 PID 19420 占用 3001，其余 `EADDRINUSE` 崩溃，属启动脚本重复拉起，不影响运行中的实例。

---

## Phase 13 — MinerU 直连 HTTP API + 设置面板两栏布局（2026-08-12）

### 背景

MinerU 的 `mineru-open-api` CLI 本质是云端 API 的 thin client（`extract` 走精准解析 API，需 token）。原实现 spawn 本地 CLI，对将来桌面端打包不友好（需用户单独装 CLI、Windows 需 `shell:true` hack）。改为**后端直接 `fetch` 调 MinerU 精准解析 API**，彻底移除 CLI 依赖；同时在设置面板配置 MinerU token，并把设置界面改为参考 OpenChamber 的两栏布局。

### MinerU API 链路（`mineru.ts` 重写）

```
extractPdfToMd(pdfPath, id):
  1. token = settings.mineruToken（未配置抛「请先配置 MinerU Token」）
  2. POST /api/v4/file-urls/batch  { files:[{name, data_id:id}], model_version:"vlm" }
     header Authorization: Bearer <token> → batch_id + file_urls[]
  3. PUT 文件到 file_urls[0]（raw body）
  4. GET /api/v4/extract-results/batch/{batch_id} 轮询（3s/次，10min 超时）
     done → full_zip_url；failed → 抛错（含 err_msg）；running/pending/converting → 继续
  5. 下载 zip → yauzl 解压（保留目录结构、防御路径穿越）→ full.md + images/
  6. 写 MD_DIR/{id}.md，图片复制到 IMAGES_DIR
```

- 精准解析 API 上限 200MB / 200 页，超限在本地 `statSync` 提前拦截
- 依赖：`yauzl`（解压，纯 JS 无原生依赖，桌面打包友好）
- 函数签名 `extractPdfToMd(pdfPath, id)` 不变，`store.ts` / `import-tmp-papers.ts` 无需改动
- CLI（`mineru-open-api`）不再被调用，但保留已安装环境不影响

### 设置面板两栏布局

参考 OpenChamber 设置页：Modal 宽度 520 → 680px，内部左侧分类导航（模型 / 数据源）+ 右侧内容区：

- **模型**：API Key、默认模型、API Base URL、**MinerU Token**（新增，Password 输入 + mineru.net/apiManage/token 获取链接）、测试连接
- **数据源**：各源开关 + 可选 API Key（原内容原样迁移）
- 数据源内容需切换到「数据源」分类才渲染

### 数据流

- `settings.json` 新增 `mineruToken` 字段（明文，与 apiKey 同模式）；`AppSettings`/`readSettings`/`writeSettings`/settings API 全链路透传
- 前端 `Settings` 类型、`getSettings`/`saveSettings`、`api.getSettings`/`saveSettings` 同步

### 修改文件清单

```
新增:
  app/server/src/__tests__/mineru.test.ts       (4 用例：成功全流程 / 无 token / 任务失败 / 超限)
  app/web-next/src/__tests__/SettingsDialog.test.tsx (重写：两栏 + MinerU token 用例)

修改:
  app/server/package.json                       (+ yauzl; dev: @types/yauzl, yazl)
  app/server/src/mineru.ts                      (重写：spawn CLI → fetch MinerU API + zip 解压)
  app/server/src/settingsStore.ts               (+ mineruToken 字段)
  app/server/src/index.ts                       (settings API 返回/接收 mineruToken)
  app/server/src/__tests__/settingsStore.test.ts (+ mineruToken 读写 2 用例)
  app/server/src/__tests__/chat.api.test.ts     (+ mineruToken 持久化 1 用例)
  app/web-next/src/types.ts / api.ts / lib/settings.ts (透传 mineruToken)
  app/web-next/src/components/SettingsDialog.tsx (两栏布局 + MinerU Token 输入)
  AGENTS.md
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 120 tests ✅（原 113 + 新增 7） |
| 前端单元 + 集成 | 46 tests ✅（原 44 + SettingsDialog 重写净增 2） |
| TypeScript 编译（server + web-next） | ✅ |
| Vite 构建 | ✅ |

> 待办：存量解析失败论文（2607.13336 / 2604.22084）本轮未重试；配置 MinerU Token 后可在 /research 手动补跑。

---

## Phase 14 — LLM 多 Provider 支持 + 设置面板三栏布局（2026-08-12）

### 功能

设置面板改为参考 OpenChamber 的三栏布局，并将 LLM 配置从单一 `apiKey/baseUrl` 升级为**多 Provider CRUD**：

- **三栏布局**（仅「模型」分类）：左导航（模型/数据源）→ 中栏提供商列表（**LLM / MinerU**）→ 右栏详情
- **LLM 提供商 CRUD**：默认内置一个 DeepSeek；可新增/编辑/删除任意 OpenAI 兼容提供商（名称 + API Key + Base URL），任意一个可设为「当前使用」；全局模型（v4-flash / v4-pro）独立于提供商
- **数据源分类**：保持原有平铺列表不变
- **MinerU 分类**：中栏点 MinerU → 右栏 Token 输入
- **Chat/分类/翻译/自动收录分类**统一走 `getActiveProvider(settings)` 取 apiKey + baseUrl

### 数据模型

`settings.json` 新结构：

```json
{
  "providers": [
    { "id": "deepseek", "name": "DeepSeek", "apiKey": "sk-xxx", "baseUrl": "https://api.deepseek.com/v1" }
  ],
  "activeProviderId": "deepseek",
  "model": "v4-flash",
  "mineruToken": "",
  "sources": {}
}
```

- **自动迁移**：旧 `{ apiKey, baseUrl }` 读取时自动生成默认 DeepSeek provider；旧字段保留不写回，用户保存后覆盖为新格式
- `getActiveProvider(settings)`：返回 `activeProviderId` 对应 provider，兜底 providers[0]
- provider id 自动 sanitize（非法字符 → `-`）+ 去重后缀

### 修改文件清单

```
修改:
  app/server/src/settingsStore.ts   (LLMProvider + providers + activeProviderId + getActiveProvider + 迁移)
  app/server/src/index.ts           (settings API 返回/接收 providers + activeProviderId)
  app/server/src/chat.ts            (/chat + /chat/test 改读 getActiveProvider)
  app/server/src/classify.ts        (分类改读 active provider)
  app/server/src/translateMd.ts     (翻译改读 active provider)
  app/server/src/research.ts        (自动收录分类改读 active provider)
  app/server/src/__tests__/settingsStore.test.ts (providers CRUD/迁移/sanitize，6 用例)
  app/server/src/__tests__/chat.api.test.ts     (+ providers 持久化 1 用例)
  app/server/src/__tests__/mineru.test.ts       (writeSettings 去 apiKey 参数)
  app/web-next/src/types.ts         (LLMProvider + Settings 重构)
  app/web-next/src/api.ts           (settings API 类型)
  app/web-next/src/lib/settings.ts  (defaultProviders/activeProvider/getSettings 透传)
  app/web-next/src/components/SettingsDialog.tsx (三栏布局 + Provider CRUD + MinerU)
  app/web-next/src/pages/PaperReader.tsx / GlobalChat.tsx (apiKey → activeProvider(settings).apiKey)
  app/web-next/src/__tests__/SettingsDialog.test.tsx (重写：三栏 + CRUD，10 用例)
  app/web-next/src/__tests__/PaperList.test.tsx  (设置弹窗断言更新)
  AGENTS.md
```

### 测试（最终）

| 层级 | 结果 |
|---|---|
| 后端单元 + API | 126 tests ✅（原 120 + 新增 6） |
| 前端单元 + 集成 | 49 tests ✅（原 46 + SettingsDialog 净增 3） |
| TypeScript 编译（server + web-next） | ✅ |
| Vite 构建 | ✅ |
