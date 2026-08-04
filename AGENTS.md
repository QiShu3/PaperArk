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
