# Sestaví instalátor StartSite (Velopack) a volitelně ho vydá na GitHub jako aktualizaci.
#
#   npm run release -- -Version 0.3.0            jen sestaví do artifacts/releases
#   npm run release -- -Version 0.3.0 -Upload    sestaví a vydá na GitHub (potřebuje GITHUB_TOKEN)
#
# Kamarádi stáhnou StartSite-win-Setup.exe z GitHub Releases. Nainstalovaná aplikace
# si nové verze najde sama a nabídne "Aktualizovat a restartovat".
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$Upload
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$repoUrl = 'https://github.com/hrabafh-debug/StartSite'
$artifacts = Join-Path $root 'artifacts'
$app = Join-Path $artifacts 'app'
$releases = Join-Path $artifacts 'releases'
$backend = Join-Path $app 'backend'
$esbuild = Join-Path $root 'node_modules\.bin\esbuild.cmd'

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }

Step "Build TypeScript (shared, server, mcp, cli)"
Push-Location $root
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build selhal' }
Pop-Location

Step "Publish desktopové aplikace $Version"
if (Test-Path $app) { Remove-Item -Recurse -Force $app }
dotnet publish (Join-Path $root 'desktop\StartSite.Desktop') -c Release -f net10.0-windows10.0.19041.0 -r win-x64 `
  -p:Version=$Version -p:ApplicationDisplayVersion=$Version -o $app
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish selhal' }

Step "Backend: zabalení do samostatných souborů (esbuild)"
# Každý vstup se zabalí i se závislostmi, node_modules pak v instalaci nejsou potřeba.
# Struktura složek zůstává jako v repu (server/dist, mcp/dist, cli/dist), aby seděly relativní cesty.
$banner = "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
$bundles = @(
  @{ In = 'server\dist\index.js'; Out = 'server\dist\index.js' },
  @{ In = 'server\dist\static-server.js'; Out = 'server\dist\static-server.js' },
  @{ In = 'mcp\dist\index.js'; Out = 'mcp\dist\index.js' },
  @{ In = 'cli\dist\index.js'; Out = 'cli\dist\index.js' }
)
foreach ($b in $bundles) {
  & $esbuild (Join-Path $root $b.In) --bundle --platform=node --format=esm --target=node20 `
    --log-level=warning "--banner:js=$banner" "--outfile=$(Join-Path $backend $b.Out)"
  if ($LASTEXITCODE -ne 0) { throw "esbuild selhal: $($b.In)" }
}
Copy-Item (Join-Path $root 'mcp\index.js') (Join-Path $backend 'mcp\index.js')
New-Item -ItemType Directory -Force (Join-Path $backend 'cli\bin') | Out-Null
Copy-Item (Join-Path $root 'cli\bin\startsite.js') (Join-Path $backend 'cli\bin\startsite.js')
'{ "name": "startsite-backend", "private": true, "type": "module" }' | Set-Content -Encoding utf8 (Join-Path $backend 'package.json')
# Značka instalace: data půjdou do %LOCALAPPDATA%\StartSiteData, ne do složky aplikace
Set-Content -Encoding utf8 (Join-Path $backend '.installed') $Version

Step "Přibalení Node.js (kamarádi ho nemusí mít)"
$node = (Get-Command node).Source
New-Item -ItemType Directory -Force (Join-Path $backend 'node') | Out-Null
Copy-Item $node (Join-Path $backend 'node\node.exe')
Write-Host "Node $(& $node --version) z $node"

Step "Kontrola: zabalený backend se spustí"
$env:STARTSITE_DATA = Join-Path $artifacts 'smoke-data'
$env:STARTSITE_PORT = '4599'
$smoke = Start-Process -FilePath (Join-Path $backend 'node\node.exe') -ArgumentList "`"$(Join-Path $backend 'server\dist\index.js')`"" -PassThru -WindowStyle Hidden
try {
  $ok = $false
  for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 300
    try { $ok = (Invoke-WebRequest 'http://127.0.0.1:4599/api/health' -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200 } catch {}
  }
  if (-not $ok) { throw 'Zabalený backend neodpověděl na /api/health' }
  Write-Host 'Backend odpovídá.'
} finally {
  Stop-Process -Id $smoke.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:STARTSITE_DATA, Env:STARTSITE_PORT -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $artifacts 'smoke-data') -ErrorAction SilentlyContinue
}

Step "Velopack: instalátor a balíček aktualizace"
New-Item -ItemType Directory -Force $releases | Out-Null
# Předchozí verze z GitHubu, aby vznikl i rozdílový (delta) balíček. Napoprvé tam nic není.
vpk download github --repoUrl $repoUrl --outputDir $releases 2>$null
$icon = Join-Path $root 'desktop\StartSite.Desktop\obj\Release\net10.0-windows10.0.19041.0\win-x64\resizetizer\r\appicon.ico'
$packArgs = @('pack', '--packId', 'StartSite', '--packVersion', $Version, '--packDir', $app, '--mainExe', 'StartSite.exe',
  '--packTitle', 'StartSite', '--packAuthors', 'hrabafh-debug', '--outputDir', $releases, '--shortcuts', 'Desktop,StartMenuRoot')
if (Test-Path $icon) { $packArgs += @('--icon', $icon) }
vpk @packArgs
if ($LASTEXITCODE -ne 0) { throw 'vpk pack selhal' }

$setup = Join-Path $releases 'StartSite-win-Setup.exe'
Write-Host "`nInstalátor: $setup ($([math]::Round((Get-Item $setup).Length / 1MB)) MB)" -ForegroundColor Green

if ($Upload) {
  Step "Vydání na GitHub ($repoUrl)"
  if (-not $env:GITHUB_TOKEN) { throw 'Chybí GITHUB_TOKEN s právem zápisu do repozitáře' }
  $uploadArgs = @('upload', 'github', '--repoUrl', $repoUrl, '--outputDir', $releases, '--token', $env:GITHUB_TOKEN,
    '--publish', '--releaseName', "StartSite $Version", '--tag', "v$Version")
  vpk @uploadArgs
  if ($LASTEXITCODE -ne 0) { throw 'vpk upload selhal' }
  Write-Host "Vydáno: $repoUrl/releases/tag/v$Version" -ForegroundColor Green
}
