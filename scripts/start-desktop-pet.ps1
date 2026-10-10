param([switch]$SkipServices)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$petProjectPath = Join-Path $workspacePath 'desktop'
if (-not $SkipServices) {
    $servicesReady = $false
    try {
        $serviceHealth = Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 3
        $frontendHealth = Invoke-WebRequest 'http://127.0.0.1:5174' -UseBasicParsing -TimeoutSec 3
        $servicesReady = $serviceHealth.status -eq 'ok' -and $serviceHealth.worker_alive -and $frontendHealth.StatusCode -eq 200
    } catch { }
    if (-not $servicesReady) {
        $dependenciesReady = (Test-Path -LiteralPath (Join-Path $workspacePath 'backend/.venv/Scripts/python.exe')) -and (Test-Path -LiteralPath (Join-Path $workspacePath 'frontend/node_modules/vite/bin/vite.js'))
        & (Join-Path $PSScriptRoot 'start-v2.ps1') -SkipInstall:$dependenciesReady
        if ($LASTEXITCODE -ne 0) { throw '工作台服务启动失败。' }
    }
}
Push-Location $petProjectPath
try {
    $petElectronPath = Join-Path $petProjectPath 'node_modules\electron\dist\electron.exe'
    $petThreePath = Join-Path $petProjectPath 'node_modules\three\build\three.module.js'
    if (-not (Test-Path -LiteralPath $petElectronPath) -or -not (Test-Path -LiteralPath $petThreePath)) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw '小狒依赖安装失败，请检查网络后重试。' }
    }
    Start-Process -FilePath $petElectronPath -ArgumentList ('"' + $petProjectPath + '"') -WorkingDirectory $petProjectPath -WindowStyle Hidden
} finally { Pop-Location }
