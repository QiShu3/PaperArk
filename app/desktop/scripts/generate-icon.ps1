# 生成占位应用图标 app/desktop/build/icon.ico（antd 蓝底 + 白色 "A"）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/generate-icon.ps1
# 生成后可随时被设计师版本替换（仍需多尺寸 ico，至少 256x256）
try { Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop } catch { }
try { Add-Type -AssemblyName System.Drawing -ErrorAction Stop } catch { }

$sizes = @(16, 32, 48, 64, 128, 256)
$images = @()

foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  # antd 主题蓝 #1677ff
  $g.Clear([System.Drawing.Color]::FromArgb(22, 119, 255))

  $fontSize = [math]::Max(7, $size * 0.6)
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $g.DrawString('A', $font, [System.Drawing.Brushes]::White, $rect, $sf)
  $font.Dispose()
  $sf.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += , $ms.ToArray()
  $ms.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}

# 组装 ICO（PNG-in-ICO，Vista+ 支持）
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim)
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$images[$i].Length)
  $bw.Write([uint32]$offset)
  $offset += $images[$i].Length
}
foreach ($img in $images) { $bw.Write($img) }

$target = Join-Path $PSScriptRoot '..\build\icon.ico'
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
[System.IO.File]::WriteAllBytes((Resolve-Path (Split-Path $target)).Path + '\icon.ico', $out.ToArray())
$bw.Dispose(); $out.Dispose()
Write-Host "icon generated: $target ($((Get-Item $target).Length) bytes)"
