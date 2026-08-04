# Papers 知识库 · Web App

基于本知识库(`rawPDF/` + `MD/`)的本地 Web 应用,提供论文的增删改查、全文搜索、标签管理,以及上传 PDF 自动调用 MinerU 解析为 Markdown。

## 架构

- **前端** `web/`:React 19 + Vite + TypeScript + shadcn/ui(Tailwind v4)+ react-query。
- **后端** `server/`:Node + Express,直接读写知识库文件;`Create` 时 spawn `mineru-open-api` 解析 PDF。
- **文件系统即真相**:不引入数据库。标题取自 MD 首行标题;标签等元数据存于 `Papers/papers.json`;任何写操作后自动重生成 `MD/index.md`(与根目录 README 的脚本契约一致)。

```
浏览器 (React SPA)  ⇄  Express + Vite(开发代理)  ⇄  Papers/ 文件系统
                              └─ spawn mineru-open-api (新增解析)
```

## 前置条件

- Node 22+、pnpm
- 已认证的 MinerU CLI(新增论文时需要):`mineru-open-api auth --verify`

## 快速开始

```bash
cd app
pnpm install
pnpm dev          # 同时启动后端 (3001) 与前端 (5173)
```

打开 http://localhost:5173 。开发模式下 Vite 会把 `/api`、`/rawPDF`、`/MD` 代理到后端。

### 生产模式

```bash
pnpm build        # 构建前端到 web/dist
pnpm start        # Express 以 production 模式同时托管 API 与静态前端
```

默认端口 3001,可用 `PORT` 环境变量覆盖;知识库根目录默认为 `app/` 的上级目录,可用 `PAPERS_ROOT` 覆盖。

## 功能与 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/papers` | 论文列表(标题、标签、是否有 MD/PDF) |
| GET | `/api/papers/:id` | 详情(Markdown 原文 + 元数据) |
| POST | `/api/papers` | 上传 PDF(multipart),MinerU 解析后入库 |
| PUT | `/api/papers/:id` | 更新 markdown / tags / notes |
| DELETE | `/api/papers/:id` | 删除 PDF、MD 与不再被引用的图片 |
| GET | `/api/search?q=` | 标题 + 正文全文搜索,返回命中片段 |
| GET | `/api/tags` | 标签及计数 |
| 静态 | `/rawPDF/*`、`/MD/images/*` | PDF 与论文图片 |

前端功能:列表(搜索 + 标签筛选)、双栏阅读(左 Markdown 渲染含 KaTeX 公式、右内嵌 PDF)、实时预览编辑器、标签编辑、上传解析、删除确认。

## 说明

- 论文 ID = 文件 basename(去 `.pdf`),如 `2510.27285v4`。
- 图片为内容寻址(sha256 命名)且跨论文共享;删除论文时仅清理**不再被任何 MD 引用**的孤儿图片。
- 新增论文的解析依赖 MinerU,耗时约 30 秒至数分钟,前端会显示进度状态。
- 目录结构:

```
app/
├── server/src/    # Express API + 文件读写 + MinerU 调用 + index 重生成
└── web/src/
    ├── pages/     # PaperList / PaperReader
    ├── components/# MarkdownView / PdfViewer / MdEditor / TagEditor / UploadDialog / ui( shadcn)
    ├── api.ts     # fetch 封装
    └── types.ts
```
