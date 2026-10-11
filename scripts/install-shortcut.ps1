# Vytvoří zástupce desktopové aplikace StartSite na ploše a v nabídce Start.
# Spuštění: npm run shortcut  (předtím npm run build:desktop)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'desktop\publish\StartSite.exe'
if (-not (Test-Path $exe)) {
  throw "Aplikace není sestavená ($exe). Spusť nejdřív: npm run build:desktop"
}

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
foreach ($dir in $targets) {
  $path = Join-Path $dir 'StartSite.lnk'
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = Split-Path $exe
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'Spouštěč lokálních projektů'
  $lnk.Save()
  Write-Output "Zástupce: $path"
}
