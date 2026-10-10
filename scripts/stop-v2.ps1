$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $workspacePath 'backend'
$frontendPath = Join-Path $workspacePath 'frontend'
foreach ($portNumber in @(8000, 5174)) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $portNumber -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        $isApi = $processInfo.CommandLine -like "*$backendPath*.venv*uvicorn app.main:app*"
        $isFrontend = $processInfo.CommandLine -like "*$frontendPath*node_modules*vite*bin*vite.js*"
        if ($isApi -or $isFrontend) { Stop-Process -Id $listener.OwningProcess; Write-Host "Stopped v2 process $($listener.OwningProcess)" }
        else { Write-Host "Kept unrelated process on port $portNumber" }
    }
}
Write-Host 'Database and Mailpit containers remain running; data is retained.'
$runtimeRecord = Join-Path $backendPath '.runtime/processes.json'
if (Test-Path -LiteralPath $runtimeRecord) {
    $workerId = (Get-Content -LiteralPath $runtimeRecord -Raw | ConvertFrom-Json).worker
    if ($workerId) {
        $workerInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$workerId"
        if ($workerInfo.CommandLine -like "*$backendPath*.venv*app.worker*") { Stop-Process -Id $workerId; Write-Host 'Stopped v2 worker' }
    }
}
