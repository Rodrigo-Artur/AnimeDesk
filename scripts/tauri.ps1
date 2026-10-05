param(
  [ValidateSet('dev', 'build')]
  [string]$Mode = 'dev'
)

$ErrorActionPreference = 'Stop'
$vsDevCmd = 'D:\VSBuildTools\Common7\Tools\VsDevCmd.bat'

if (-not (Test-Path $vsDevCmd)) {
  throw "Visual Studio Build Tools não encontrado em $vsDevCmd"
}

$vsEnvironment = cmd /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
foreach ($line in $vsEnvironment) {
  if ($line -match '^([^=]+)=(.*)$') {
    Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2]
  }
}

$env:CARGO_HOME = [Environment]::GetEnvironmentVariable('CARGO_HOME', 'User')
$env:RUSTUP_HOME = [Environment]::GetEnvironmentVariable('RUSTUP_HOME', 'User')

if (-not $env:CARGO_HOME) { $env:CARGO_HOME = 'D:\DevTools\Rust\cargo' }
if (-not $env:RUSTUP_HOME) { $env:RUSTUP_HOME = 'D:\DevTools\Rust\rustup' }

$env:Path = "$env:CARGO_HOME\bin;$env:Path"
$env:CARGO_TARGET_DIR = 'D:\AnimeDeskTauriBuild\target'
New-Item -ItemType Directory -Force $env:CARGO_TARGET_DIR | Out-Null

Push-Location (Join-Path $PSScriptRoot '..')
try {
  if ($Mode -eq 'dev') {
    & npm exec tauri -- dev
  } else {
    & npm exec tauri -- build
  }
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
