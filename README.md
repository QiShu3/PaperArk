# Papers

本目录管理一批 AI 相关论文的 PDF 原文和 MinerU 精确解析后的 Markdown 结果。

## 目录结构

```
Papers/
├── README.md          # 本文件
├── rawPDF/            # PDF 原文（按 arXiv ID 命名）
├── MD/                # MinerU 精确解析输出的 Markdown
│   ├── index.md       # 论文索引（自动生成）
│   └── images/        # 解析提取的图片
```

- PDF 和 MD 文件名均为 arXiv ID（如 `2510.27285v4.pdf` / `2510.27285v4.md`），一一对应。
- 新增论文只需将 PDF 放入 `rawPDF/`，运行下方脚本即可完成解析并更新索引。

## 新增一篇论文

### 1. 放入 PDF

将论文 PDF 放入 `rawPDF/`，以 arXiv ID 命名，如 `2601.12345v1.pdf`。

### 2. 检测并解析未处理的 PDF

```powershell
# 自动检测 rawPDF/ 中尚未解析的 PDF
$pdfs = Get-ChildItem rawPDF/*.pdf | Where-Object { -not (Test-Path "MD/$($_.BaseName).md") }
if ($pdfs) {
  Write-Host "发现 $($pdfs.Count) 篇待解析论文"
  $pdfs.FullName | Set-Content -Path "filelist.txt" -Encoding UTF8
  mineru-open-api extract --list filelist.txt -o "MD/" -f md
  Remove-Item filelist.txt
} else {
  Write-Host "无需处理的新论文。"
}
```

### 3. 重新生成索引

```powershell
# 从 MD 文件提取标题，重新生成 index.md
$rows = @(); $i = 0
Get-ChildItem "MD/*.md" | Sort-Object Name | ForEach-Object {
  $i++
  $title = (Get-Content $_.FullName -TotalCount 1) -replace '^#\s+', ''
  $id = $_.BaseName
  $rows += "| $i | $title | $id | [PDF](../rawPDF/$id.pdf) · [arXiv](https://arxiv.org/abs/$id) |"
}
@"
# Papers Index

| # | 标题 | arXiv ID | 链接 |
|---|------|----------|------|
$($rows -join "`n")
"@ | Set-Content "MD/index.md" -Encoding UTF8
Write-Host "index.md 已更新，共 $i 篇论文。"
```

## 批量重新解析全部 PDF

```powershell
Get-ChildItem rawPDF/*.pdf | ForEach-Object FullName | Set-Content -Path "filelist.txt" -Encoding UTF8
mineru-open-api extract --list filelist.txt -o "MD/" -f md
Remove-Item filelist.txt
```
