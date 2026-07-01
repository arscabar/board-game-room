param(
  [int]$Port = 3001,
  [switch]$Docker,
  [switch]$NoBuild,
  [switch]$NoClipboard,
  [switch]$OpenBrowser,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$runDir = Join-Path $root ".local-host"
$appOut = Join-Path $runDir "app.out.log"
$appErr = Join-Path $runDir "app.err.log"
$tunnelOut = Join-Path $runDir "cloudflare.out.log"
$tunnelErr = Join-Path $runDir "cloudflare.err.log"
$publicUrlFile = Join-Path $runDir "public-url.txt"
$imageName = "board-game-room:local"
$containerName = "board-game-room-local"

function Show-Usage {
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/start-local-tunnel.ps1"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/start-local-tunnel.ps1 -Docker"
  Write-Host ""
  Write-Host "Options:"
  Write-Host "  -Docker       Build/run the app with Docker Desktop instead of local Node."
  Write-Host "  -NoBuild      Skip npm build or docker build."
  Write-Host "  -Port 3001    Local port to expose through Cloudflare Tunnel."
  Write-Host "  -OpenBrowser  Open the public tunnel URL in the default browser."
  Write-Host "  -NoClipboard  Do not copy the public URL to the clipboard."
  Write-Host ""
}

function Assert-Command($name, $installHint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name was not found. $installHint"
  }
}

function Invoke-Checked($file, [string[]]$arguments) {
  & $file @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $file $($arguments -join ' ')"
  }
}

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-Health([int]$timeoutSeconds) {
  for ($index = 0; $index -lt $timeoutSeconds; $index += 1) {
    if (Test-Health) {
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "The local server did not answer http://127.0.0.1:$Port/api/health within $timeoutSeconds seconds."
}

function Test-DockerReady {
  & docker info *> $null
  return $LASTEXITCODE -eq 0
}

function Start-DockerDesktop {
  if (Test-DockerReady) {
    return
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LocalAppData "Docker\Docker Desktop\Docker Desktop.exe"),
    (Join-Path $env:LocalAppData "Docker\Docker\Docker Desktop.exe")
  )

  $dockerDesktop = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $dockerDesktop) {
    throw "Docker Desktop is not running, and Docker Desktop.exe was not found."
  }

  Write-Host "Starting Docker Desktop..."
  Start-Process -FilePath $dockerDesktop | Out-Null

  for ($index = 0; $index -lt 120; $index += 1) {
    if (Test-DockerReady) {
      Write-Host "Docker is ready."
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "Docker Desktop did not become ready in time."
}

function Start-NativeServer {
  if (Test-Health) {
    Write-Host "Using the server already running on http://localhost:$Port"
    return $null
  }

  Assert-Command "node" "Install Node.js 22 or later."
  Assert-Command "npm" "Install Node.js/npm."

  if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-Host "Installing npm dependencies..."
    Invoke-Checked "npm" @("install")
  }

  if (-not $NoBuild) {
    Write-Host "Building web app..."
    Invoke-Checked "npm" @("run", "build")
  }

  $tsxCli = Join-Path $root "node_modules\tsx\dist\cli.mjs"
  if (-not (Test-Path $tsxCli)) {
    throw "tsx CLI was not found at $tsxCli. Run npm install first."
  }

  if (-not $env:STATS_FILE) {
    $env:STATS_FILE = Join-Path $root "data\stats.json"
  }
  $env:PORT = [string]$Port
  $env:HOST = "0.0.0.0"

  Write-Host "Starting local Node server on http://localhost:$Port ..."
  $nodePath = (Get-Command "node").Source
  return Start-Process `
    -FilePath $nodePath `
    -ArgumentList @($tsxCli, "server/index.ts") `
    -WorkingDirectory $root `
    -RedirectStandardOutput $appOut `
    -RedirectStandardError $appErr `
    -WindowStyle Hidden `
    -PassThru
}

function Start-DockerServer {
  if (Test-Health) {
    Write-Host "Using the server already running on http://localhost:$Port"
    return $null
  }

  Assert-Command "docker" "Install Docker Desktop."
  Start-DockerDesktop

  if (-not $NoBuild) {
    Write-Host "Building Docker image $imageName ..."
    Invoke-Checked "docker" @("build", "-t", $imageName, ".")
  }

  & docker rm -f $containerName *> $null

  Write-Host "Starting Docker container on http://localhost:$Port ..."
  return Start-Process `
    -FilePath "docker" `
    -ArgumentList @(
      "run",
      "--rm",
      "--name", $containerName,
      "-p", "${Port}:3001",
      "-e", "PORT=3001",
      "-e", "STATS_FILE=/tmp/board-game-stats.json",
      $imageName
    ) `
    -WorkingDirectory $root `
    -RedirectStandardOutput $appOut `
    -RedirectStandardError $appErr `
    -WindowStyle Hidden `
    -PassThru
}

function Get-TunnelUrl {
  $text = ""
  foreach ($file in @($tunnelOut, $tunnelErr)) {
    if (Test-Path $file) {
      $text += "`n" + (Get-Content -Raw $file -ErrorAction SilentlyContinue)
    }
  }

  $match = [regex]::Match($text, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
  if ($match.Success) {
    return $match.Value
  }
  return $null
}

function Start-CloudflareTunnel {
  Assert-Command "cloudflared" "Install cloudflared from Cloudflare Tunnel downloads."

  if (Test-Path $publicUrlFile) {
    Remove-Item -LiteralPath $publicUrlFile -Force
  }

  Write-Host "Starting Cloudflare Tunnel..."
  $process = Start-Process `
    -FilePath "cloudflared" `
    -ArgumentList @("tunnel", "--url", "http://localhost:$Port", "--no-autoupdate") `
    -WorkingDirectory $root `
    -RedirectStandardOutput $tunnelOut `
    -RedirectStandardError $tunnelErr `
    -WindowStyle Hidden `
    -PassThru

  for ($index = 0; $index -lt 60; $index += 1) {
    $url = Get-TunnelUrl
    if ($url) {
      Set-Content -LiteralPath $publicUrlFile -Value $url -Encoding UTF8
      if (-not $NoClipboard) {
        try {
          Set-Clipboard -Value $url
        } catch {
          Write-Host "Could not copy the URL to the clipboard."
        }
      }
      if ($OpenBrowser) {
        Start-Process $url | Out-Null
      }

      Write-Host ""
      Write-Host "Public URL:"
      Write-Host "  $url"
      Write-Host ""
      Write-Host "Local URL:"
      Write-Host "  http://localhost:$Port"
      Write-Host ""
      Write-Host "The public URL was saved to:"
      Write-Host "  $publicUrlFile"
      if (-not $NoClipboard) {
        Write-Host "The public URL was also copied to the clipboard."
      }
      Write-Host ""
      Write-Host "Keep this PowerShell window open. Press Ctrl+C to stop."
      Write-Host ""
      return $process
    }

    if ($process.HasExited) {
      $log = ""
      if (Test-Path $tunnelErr) {
        $log = Get-Content -Tail 20 $tunnelErr -ErrorAction SilentlyContinue
      }
      throw "cloudflared exited before a public URL was created. $log"
    }

    Start-Sleep -Seconds 1
  }

  throw "Cloudflare Tunnel did not print a trycloudflare.com URL within 60 seconds."
}

function Stop-StartedProcess($process, $name) {
  if ($null -eq $process) {
    return
  }

  try {
    if (-not $process.HasExited) {
      Write-Host "Stopping $name..."
      Stop-Process -Id $process.Id -Force
    }
  } catch {
    Write-Host "Could not stop $name cleanly."
  }
}

if ($Help) {
  Show-Usage
  exit 0
}

New-Item -ItemType Directory -Force -Path $runDir | Out-Null
Set-Location $root

$serverProcess = $null
$tunnelProcess = $null

try {
  if ($Docker) {
    $serverProcess = Start-DockerServer
  } else {
    $serverProcess = Start-NativeServer
  }

  Wait-Health 90
  $tunnelProcess = Start-CloudflareTunnel

  while ($true) {
    if ($tunnelProcess.HasExited) {
      throw "Cloudflare Tunnel stopped."
    }

    if ($serverProcess -and $serverProcess.HasExited) {
      throw "The local server stopped."
    }

    Start-Sleep -Seconds 2
  }
} finally {
  Stop-StartedProcess $tunnelProcess "Cloudflare Tunnel"
  Stop-StartedProcess $serverProcess "local server"
  if ($Docker) {
    & docker rm -f $containerName *> $null
  }
}
