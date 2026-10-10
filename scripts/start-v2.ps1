param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $workspacePath 'backend'
$frontendPath = Join-Path $workspacePath 'frontend'
$runtimePath = Join-Path $backendPath '.runtime'
$pythonPath = Join-Path $backendPath '.venv/Scripts/python.exe'
function Invoke-Checked([scriptblock]$Action) {
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
}
Push-Location $workspacePath
try {
    Invoke-Checked { docker compose up -d --wait }
    if (-not (Test-Path -LiteralPath $pythonPath)) { Invoke-Checked { python -m venv (Join-Path $backendPath '.venv') } }
    if (-not $SkipInstall) {
        Invoke-Checked { & $pythonPath -m pip install -r (Join-Path $backendPath 'requirements.txt') }
        Push-Location $frontendPath
        try { Invoke-Checked { npm.cmd ci } } finally { Pop-Location }
    }
    Push-Location $backendPath
    try { Invoke-Checked { & $pythonPath -m alembic upgrade head } } finally { Pop-Location }
    New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
    $credentialPath = Join-Path $runtimePath 'credential.key'
    if (-not (Test-Path -LiteralPath $credentialPath)) {
        Invoke-Checked { & $pythonPath -c "import sys; from cryptography.fernet import Fernet; from pathlib import Path; Path(sys.argv[1]).write_bytes(Fernet.generate_key())" $credentialPath }
    }
    foreach ($portNumber in @(8000, 5174)) {
        if (Get-NetTCPConnection -State Listen -LocalPort $portNumber -ErrorAction SilentlyContinue) {
            throw "Port $portNumber is occupied. If v2 is already running, open http://localhost:5174; otherwise free that port first."
        }
    }
    $apiProcess = Start-Process -FilePath $pythonPath -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000','--no-access-log' -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'api.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'api.stderr.log')
    $vitePath = Join-Path $frontendPath 'node_modules/vite/bin/vite.js'
    $frontendProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList ('"' + $vitePath + '"'),'--host','127.0.0.1' -WorkingDirectory $frontendPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'frontend.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'frontend.stderr.log')
    $workerProcess = Start-Process -FilePath $pythonPath -ArgumentList '-m','app.worker' -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'worker.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'worker.stderr.log')
    @{ api = $apiProcess.Id; frontend = $frontendProcess.Id; worker = $workerProcess.Id } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'processes.json')
    $deadline = (Get-Date).AddSeconds(45)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        if ($apiProcess.HasExited -or $frontendProcess.HasExited) { throw "Startup failed. Check logs in $runtimePath" }
        try {
            # Probe IPv4 directly: some Windows localhost resolvers wait on IPv6
            # longer than this timeout before falling back to 127.0.0.1.
            $health = Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2
            $page = Invoke-WebRequest 'http://127.0.0.1:5174' -TimeoutSec 2
            if ($health.status -eq 'ok' -and $page.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw "Startup timed out. Check logs in $runtimePath" }
    Write-Host 'V2: http://localhost:5174'
    Write-Host 'Local verification/reset inbox: http://localhost:28025'
    Write-Host 'API docs: http://localhost:8000/api/docs'
} finally { Pop-Location }
