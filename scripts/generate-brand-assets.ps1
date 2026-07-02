param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function New-Color([string]$Hex, [int]$Alpha = 255) {
  $hexValue = $Hex.TrimStart("#")
  $r = [Convert]::ToInt32($hexValue.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($hexValue.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($hexValue.Substring(4, 2), 16)
  return [System.Drawing.Color]::FromArgb($Alpha, $r, $g, $b)
}

function New-RoundedRect([float]$X, [float]$Y, [float]$W, [float]$H, [float]$R) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $R * 2
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Set-Quality([System.Drawing.Graphics]$G) {
  $G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $G.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $G.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $G.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
}

function Fill-Wood([System.Drawing.Graphics]$G, [int]$W, [int]$H) {
  $rect = [System.Drawing.RectangleF]::new(0, 0, [single]$W, [single]$H)
  $wood = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, (New-Color "#24140c"), (New-Color "#5b3822"), [single]28)
  $G.FillRectangle($wood, $rect)
  $wood.Dispose()

  $pen1 = [System.Drawing.Pen]::new((New-Color "#d9a35b" 34), [single]([Math]::Max(1, $W / 180)))
  $pen2 = [System.Drawing.Pen]::new((New-Color "#140804" 42), [single]([Math]::Max(1, $W / 220)))
  for ($x = -$W; $x -lt ($W * 2); $x += [Math]::Max(11, [int]($W / 22))) {
    $G.DrawLine($pen1, $x, 0, $x + ($W * 0.22), $H)
  }
  for ($x = [int]($W / 10); $x -lt $W; $x += [Math]::Max(23, [int]($W / 9))) {
    $G.DrawLine($pen2, $x, 0, $x - ($W * 0.12), $H)
  }
  $pen1.Dispose()
  $pen2.Dispose()
}

function Draw-Pips([System.Drawing.Graphics]$G, [float]$X, [float]$Y, [float]$S, [int]$Value) {
  $pipBrush = New-Object System.Drawing.SolidBrush (New-Color "#27170e")
  $r = $S * 0.065
  $points = @{
    1 = @(@(0.5, 0.5));
    2 = @(@(0.28, 0.28), @(0.72, 0.72));
    3 = @(@(0.28, 0.28), @(0.5, 0.5), @(0.72, 0.72));
    4 = @(@(0.28, 0.28), @(0.72, 0.28), @(0.28, 0.72), @(0.72, 0.72));
    5 = @(@(0.28, 0.28), @(0.72, 0.28), @(0.5, 0.5), @(0.28, 0.72), @(0.72, 0.72));
    6 = @(@(0.28, 0.24), @(0.72, 0.24), @(0.28, 0.5), @(0.72, 0.5), @(0.28, 0.76), @(0.72, 0.76))
  }
  foreach ($p in $points[$Value]) {
    $G.FillEllipse($pipBrush, $X + ($S * $p[0]) - $r, $Y + ($S * $p[1]) - $r, $r * 2, $r * 2)
  }
  $pipBrush.Dispose()
}

function Draw-BrandMark([System.Drawing.Graphics]$G, [float]$X, [float]$Y, [float]$S, [bool]$Transparent = $false) {
  if (-not $Transparent) {
    $tile = New-RoundedRect $X $Y $S $S ($S * 0.16)
    $tileRect = [System.Drawing.RectangleF]::new([single]$X, [single]$Y, [single]$S, [single]$S)
    $tileBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($tileRect, (New-Color "#5f3a21"), (New-Color "#1f1008"), [single]38)
    $G.FillPath($tileBrush, $tile)
    $tilePen = [System.Drawing.Pen]::new((New-Color "#e0ad62" 180), [single]([Math]::Max(1, $S * 0.025)))
    $G.DrawPath($tilePen, $tile)
    $tilePen.Dispose()
    $tileBrush.Dispose()
    $tile.Dispose()
  }

  $feltX = $X + ($S * 0.17)
  $feltY = $Y + ($S * 0.17)
  $feltS = $S * 0.66
  $felt = New-RoundedRect $feltX $feltY $feltS $feltS ($S * 0.09)
  $feltRect = [System.Drawing.RectangleF]::new([single]$feltX, [single]$feltY, [single]$feltS, [single]$feltS)
  $feltBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($feltRect, (New-Color "#0e6b48"), (New-Color "#063225"), [single]90)
  $G.FillPath($feltBrush, $felt)
  $feltPen = [System.Drawing.Pen]::new((New-Color "#8ee0a0" 150), [single]([Math]::Max(1, $S * 0.018)))
  $G.DrawPath($feltPen, $felt)
  $feltPen.Dispose()

  $gridPen = [System.Drawing.Pen]::new((New-Color "#dff3cf" 42), [single]([Math]::Max(1, $S * 0.006)))
  for ($i = 1; $i -lt 5; $i++) {
    $p = $feltX + ($feltS * $i / 5)
    $G.DrawLine($gridPen, $p, $feltY + ($feltS * 0.08), $p, $feltY + ($feltS * 0.92))
    $q = $feltY + ($feltS * $i / 5)
    $G.DrawLine($gridPen, $feltX + ($feltS * 0.08), $q, $feltX + ($feltS * 0.92), $q)
  }

  $dieS = $S * 0.31
  $die = New-RoundedRect ($X + $S * 0.18) ($Y + $S * 0.5) $dieS $dieS ($S * 0.055)
  $dieRect = [System.Drawing.RectangleF]::new([single]($X + $S * 0.18), [single]($Y + $S * 0.5), [single]$dieS, [single]$dieS)
  $dieBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($dieRect, (New-Color "#fff3d0"), (New-Color "#d39d52"), [single]28)
  $G.FillPath($dieBrush, $die)
  $diePen = [System.Drawing.Pen]::new((New-Color "#2b170d" 180), [single]([Math]::Max(1, $S * 0.012)))
  $G.DrawPath($diePen, $die)
  $diePen.Dispose()
  Draw-Pips $G ($X + $S * 0.18) ($Y + $S * 0.5) $dieS 5

  $cardW = $S * 0.24
  $cardH = $S * 0.36
  $card = New-RoundedRect ($X + $S * 0.56) ($Y + $S * 0.43) $cardW $cardH ($S * 0.035)
  $cardRect = [System.Drawing.RectangleF]::new([single]($X + $S * 0.56), [single]($Y + $S * 0.43), [single]$cardW, [single]$cardH)
  $cardBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($cardRect, (New-Color "#7f1f2d"), (New-Color "#d55f48"), [single]90)
  $G.FillPath($cardBrush, $card)
  $cardPen = [System.Drawing.Pen]::new((New-Color "#f5d18a" 160), [single]([Math]::Max(1, $S * 0.012)))
  $G.DrawPath($cardPen, $card)
  $cardPen.Dispose()

  $pawnBrush = New-Object System.Drawing.SolidBrush (New-Color "#e0ad62")
  $G.FillEllipse($pawnBrush, $X + ($S * 0.54), $Y + ($S * 0.22), $S * 0.16, $S * 0.16)
  $G.FillEllipse($pawnBrush, $X + ($S * 0.49), $Y + ($S * 0.34), $S * 0.26, $S * 0.13)

  $pawnBrush.Dispose()
  $cardBrush.Dispose()
  $card.Dispose()
  $dieBrush.Dispose()
  $die.Dispose()
  $gridPen.Dispose()
  $feltBrush.Dispose()
  $felt.Dispose()
}

function Save-Png([string]$Path, [int]$W, [int]$H, [scriptblock]$Draw) {
  Ensure-Dir (Split-Path $Path)
  $bitmap = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  Set-Quality $graphics
  & $Draw $graphics $W $H
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Save-IconPng([string]$Path, [int]$Size, [bool]$Round = $false, [bool]$Foreground = $false) {
  Save-Png $Path $Size $Size {
    param($G, $W, $H)
    $G.Clear([System.Drawing.Color]::Transparent)
    if ($Foreground) {
      Draw-BrandMark $G ($W * 0.15) ($H * 0.15) ($W * 0.7) $true
      return
    }
    if ($Round) {
      $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
      $clip.AddEllipse(1, 1, $W - 2, $H - 2)
      $G.SetClip($clip)
      Fill-Wood $G $W $H
      Draw-BrandMark $G ($W * 0.08) ($H * 0.08) ($W * 0.84) $true
      $G.ResetClip()
      $clip.Dispose()
      return
    }
    Fill-Wood $G $W $H
    Draw-BrandMark $G ($W * 0.08) ($H * 0.08) ($W * 0.84) $true
  }
}

function Save-Splash([string]$Path, [int]$W, [int]$H) {
  Save-Png $Path $W $H {
    param($G, $CanvasW, $CanvasH)
    Fill-Wood $G $CanvasW $CanvasH
    $markSize = [Math]::Min($CanvasW, $CanvasH) * 0.28
    $x = ($CanvasW - $markSize) / 2
    $y = ($CanvasH - $markSize) / 2 - ($CanvasH * 0.06)
    Draw-BrandMark $G $x $y $markSize $false

    $fontSize = [Math]::Max(16, [Math]::Min($CanvasW, $CanvasH) * 0.052)
    $font = New-Object System.Drawing.Font "Segoe UI", $fontSize, ([System.Drawing.FontStyle]::Bold)
    $subFont = New-Object System.Drawing.Font "Segoe UI", ($fontSize * 0.45), ([System.Drawing.FontStyle]::Regular)
    $titleBrush = New-Object System.Drawing.SolidBrush (New-Color "#fff0cf")
    $subBrush = New-Object System.Drawing.SolidBrush (New-Color "#e0ad62")
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $titleRect = [System.Drawing.RectangleF]::new(0, [single]($y + $markSize + $CanvasH * 0.035), [single]$CanvasW, [single]($fontSize * 1.4))
    $subtitleRect = [System.Drawing.RectangleF]::new(0, [single]($y + $markSize + $CanvasH * 0.1), [single]$CanvasW, [single]$fontSize)
    $G.DrawString("Board Game Room", $font, $titleBrush, $titleRect, $format)
    $G.DrawString("compact walnut tabletop", $subFont, $subBrush, $subtitleRect, $format)
    $format.Dispose()
    $titleBrush.Dispose()
    $subBrush.Dispose()
    $font.Dispose()
    $subFont.Dispose()
  }
}

function Save-OgImage([string]$Path) {
  Save-Png $Path 1200 630 {
    param($G, $W, $H)
    Fill-Wood $G $W $H
    $panel = New-RoundedRect 70 70 1060 490 36
    $panelRect = [System.Drawing.RectangleF]::new(70, 70, 1060, 490)
    $panelBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($panelRect, (New-Color "#0d593e" 235), (New-Color "#05261c" 245), [single]18)
    $G.FillPath($panelBrush, $panel)
    $panelPen = [System.Drawing.Pen]::new((New-Color "#e0ad62" 165), [single]3)
    $G.DrawPath($panelPen, $panel)
    $panelPen.Dispose()
    Draw-BrandMark $G 105 170 290 $false

    $titleFont = New-Object System.Drawing.Font "Segoe UI", 52, ([System.Drawing.FontStyle]::Bold)
    $bodyFont = New-Object System.Drawing.Font "Segoe UI", 26, ([System.Drawing.FontStyle]::Regular)
    $titleBrush = New-Object System.Drawing.SolidBrush (New-Color "#fff0cf")
    $bodyBrush = New-Object System.Drawing.SolidBrush (New-Color "#e7c48b")
    $G.DrawString("Board Game Room", $titleFont, $titleBrush, 430, 182)
    $G.DrawString("Real-time tabletop rooms", $bodyFont, $bodyBrush, 438, 286)
    $G.DrawString("Web + Android · private hands · live scores", $bodyFont, $bodyBrush, 438, 336)
    $titleBrush.Dispose()
    $bodyBrush.Dispose()
    $titleFont.Dispose()
    $bodyFont.Dispose()
    $panelBrush.Dispose()
    $panel.Dispose()
  }
}

function Save-Ico([string]$Path, [string[]]$PngPaths) {
  $entries = @()
  $offset = 6 + (16 * $PngPaths.Count)
  foreach ($pngPath in $PngPaths) {
    $bytes = [System.IO.File]::ReadAllBytes($pngPath)
    $img = [System.Drawing.Image]::FromFile($pngPath)
    $entries += [PSCustomObject]@{ Width = $img.Width; Height = $img.Height; Bytes = $bytes; Offset = $offset }
    $offset += $bytes.Length
    $img.Dispose()
  }

  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter $stream
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$entries.Count)
  foreach ($entry in $entries) {
    $writer.Write([byte]$(if ($entry.Width -ge 256) { 0 } else { $entry.Width }))
    $writer.Write([byte]$(if ($entry.Height -ge 256) { 0 } else { $entry.Height }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$entry.Bytes.Length)
    $writer.Write([UInt32]$entry.Offset)
  }
  foreach ($entry in $entries) {
    $writer.Write($entry.Bytes)
  }
  Ensure-Dir (Split-Path $Path)
  [System.IO.File]::WriteAllBytes($Path, $stream.ToArray())
  $writer.Dispose()
  $stream.Dispose()
}

$publicDir = Join-Path $Root "public"
Ensure-Dir $publicDir
$brandDir = Join-Path $publicDir "brand"
Ensure-Dir $brandDir

$faviconSvg = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="wood" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#5b3822"/>
      <stop offset="1" stop-color="#1f1008"/>
    </linearGradient>
    <linearGradient id="felt" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#0e6b48"/>
      <stop offset="1" stop-color="#063225"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="22" fill="url(#wood)"/>
  <path d="M16 18h96M22 42h84M18 77h92M34 8v112M72 8v112M104 18v92" stroke="#e0ad62" stroke-opacity=".2" stroke-width="2"/>
  <rect x="24" y="24" width="80" height="80" rx="13" fill="url(#felt)" stroke="#8ee0a0" stroke-opacity=".65" stroke-width="3"/>
  <path d="M40 26v76M56 26v76M72 26v76M88 26v76M26 40h76M26 56h76M26 72h76M26 88h76" stroke="#fff0cf" stroke-opacity=".15"/>
  <rect x="28" y="64" width="35" height="35" rx="7" fill="#fff0cf" stroke="#2b170d" stroke-width="2"/>
  <circle cx="39" cy="75" r="3.3" fill="#27170e"/><circle cx="52" cy="75" r="3.3" fill="#27170e"/><circle cx="45.5" cy="81.5" r="3.3" fill="#27170e"/><circle cx="39" cy="88" r="3.3" fill="#27170e"/><circle cx="52" cy="88" r="3.3" fill="#27170e"/>
  <rect x="72" y="55" width="27" height="43" rx="5" fill="#b53d36" stroke="#f5d18a" stroke-opacity=".8" stroke-width="2"/>
  <circle cx="78" cy="37" r="9" fill="#e0ad62"/><ellipse cx="78" cy="51" rx="14" ry="7" fill="#e0ad62"/>
</svg>
'@
[System.IO.File]::WriteAllText((Join-Path $publicDir "favicon.svg"), $faviconSvg, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $brandDir "brand-mark.svg"), $faviconSvg, [System.Text.UTF8Encoding]::new($false))

$manifest = @'
{
  "name": "Board Game Room",
  "short_name": "Board Room",
  "description": "문서화된 보드게임을 실시간 방에서 선택하고 진행하는 컴팩트한 목재 테이블 앱",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#24140c",
  "theme_color": "#17201d",
  "icons": [
    {
      "src": "/brand/brand-mark.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png"
    }
  ]
}
'@
[System.IO.File]::WriteAllText((Join-Path $publicDir "manifest.webmanifest"), $manifest, [System.Text.UTF8Encoding]::new($false))

Save-IconPng (Join-Path $publicDir "apple-touch-icon.png") 180 $false $false
Save-IconPng (Join-Path $publicDir "icon-192.png") 192 $false $false
Save-IconPng (Join-Path $publicDir "icon-512.png") 512 $false $false
Save-IconPng (Join-Path $publicDir "favicon-32.png") 32 $false $false
Save-IconPng (Join-Path $publicDir "favicon-48.png") 48 $false $false
Save-Ico (Join-Path $publicDir "favicon.ico") @((Join-Path $publicDir "favicon-32.png"), (Join-Path $publicDir "favicon-48.png"))
Remove-Item (Join-Path $publicDir "favicon-32.png"), (Join-Path $publicDir "favicon-48.png")
Save-OgImage (Join-Path $publicDir "og-image.png")
Save-OgImage (Join-Path $publicDir "og-board-game-room.png")
Save-OgImage (Join-Path $publicDir "og-board-game-room.png")

$iconSizes = @{
  "mipmap-mdpi" = 48
  "mipmap-hdpi" = 72
  "mipmap-xhdpi" = 96
  "mipmap-xxhdpi" = 144
  "mipmap-xxxhdpi" = 192
}
$foregroundSizes = @{
  "mipmap-mdpi" = 108
  "mipmap-hdpi" = 162
  "mipmap-xhdpi" = 216
  "mipmap-xxhdpi" = 324
  "mipmap-xxxhdpi" = 432
}
foreach ($density in $iconSizes.Keys) {
  $dir = Join-Path $Root "android/app/src/main/res/$density"
  Save-IconPng (Join-Path $dir "ic_launcher.png") $iconSizes[$density] $false $false
  Save-IconPng (Join-Path $dir "ic_launcher_round.png") $iconSizes[$density] $true $false
  Save-IconPng (Join-Path $dir "ic_launcher_foreground.png") $foregroundSizes[$density] $false $true
}

$splashSizes = @{
  "drawable/splash.png" = @(480, 320)
  "drawable-land-mdpi/splash.png" = @(480, 320)
  "drawable-land-hdpi/splash.png" = @(800, 480)
  "drawable-land-xhdpi/splash.png" = @(1280, 720)
  "drawable-land-xxhdpi/splash.png" = @(1600, 960)
  "drawable-land-xxxhdpi/splash.png" = @(1920, 1280)
  "drawable-port-mdpi/splash.png" = @(320, 480)
  "drawable-port-hdpi/splash.png" = @(480, 800)
  "drawable-port-xhdpi/splash.png" = @(720, 1280)
  "drawable-port-xxhdpi/splash.png" = @(960, 1600)
  "drawable-port-xxxhdpi/splash.png" = @(1280, 1920)
}
foreach ($relative in $splashSizes.Keys) {
  $size = $splashSizes[$relative]
  Save-Splash (Join-Path $Root "android/app/src/main/res/$relative") $size[0] $size[1]
}

Write-Host "Generated Board Game Room brand assets."
