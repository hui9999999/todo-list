$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$backendPath = (Resolve-Path -LiteralPath (Join-Path $workspacePath 'backend')).Path
$runtimePath = Join-Path $backendPath '.runtime'
$recordPath = Join-Path $runtimePath 'processes.json'
$pythonPath = Join-Path $backendPath '.venv\Scripts\python.exe'
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$inventory = @(Get-CimInstance Win32_Process)
$serviceIds = @([int]$record.api, [int]$record.worker)
$pythonPattern = [regex]::Escape($pythonPath)
function Is-BackendService($ProcessInfo) {
    return $ProcessInfo.Name -eq 'python.exe' -and $ProcessInfo.CommandLine -match $pythonPattern -and
        ($ProcessInfo.CommandLine -match ' -m uvicorn app\.main:app ' -or $ProcessInfo.CommandLine -match ' -m app\.worker\s*$')
}
foreach ($serviceId in $serviceIds) {
    $service = $inventory | Where-Object { $_.ProcessId -eq $serviceId }
    if (-not $service -or -not (Is-BackendService $service)) { throw 'Saved service identity changed. Restart halted.' }
}
$services = @($inventory | Where-Object {
    ($_.ProcessId -in $serviceIds -or $_.ParentProcessId -in $serviceIds) -and (Is-BackendService $_)
})
Push-Location $backendPath
try {
    & $pythonPath -c "from sqlalchemy import create_engine,select,func; from app.config import settings; from app.advanced_models import Job; e=create_engine(settings().migration_database_url); c=e.connect(); n=c.scalar(select(func.count()).select_from(Job).where(Job.state=='running')); c.close(); e.dispose(); assert n==0,'Active background jobs: wait before restarting'"
    if ($LASTEXITCODE -ne 0) { throw 'Background jobs check failed. Restart halted.' }
    & $pythonPath -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Restart halted.' }
    foreach ($service in ($services | Sort-Object { $_.ProcessId -in $serviceIds })) {
        # Verify identity again in case a PID was recycled after the inventory.
        $live = Get-CimInstance Win32_Process -Filter "ProcessId=$($service.ProcessId)"
        if ($live) {
            if ($live.CreationDate -ne $service.CreationDate -or -not (Is-BackendService $live)) { throw 'Service identity changed. Restart halted.' }
            Stop-Process -Id $live.ProcessId -ErrorAction SilentlyContinue
        }
    }
    $apiProcess = Start-Process -FilePath $pythonPath -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000','--no-access-log' -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'api.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'api.stderr.log')
    $workerProcess = Start-Process -FilePath $pythonPath -ArgumentList '-m','app.worker' -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'worker.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'worker.stderr.log')
    @{api=$apiProcess.Id;worker=$workerProcess.Id;frontend=$record.frontend} | ConvertTo-Json | Set-Content -LiteralPath $recordPath
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if ($apiProcess.HasExited -or $workerProcess.HasExited) { throw 'Backend startup failed. Check backend/.runtime logs.' }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2
            if ($health.status -eq 'ok' -and $health.worker_alive) { Write-Host 'Backend restarted; refresh http://localhost:5174'; return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw 'Backend startup timed out. Check backend/.runtime logs.'
} finally { Pop-Location }
