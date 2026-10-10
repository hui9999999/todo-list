param(
    [string]$ApiOrigin = 'http://103.236.96.53:60673',
    [string]$JavaHome = '',
    [string]$AndroidSdk = '',
    [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskFrontend = Join-Path $taskRoot 'frontend'
$taskTools = Join-Path $env:LOCALAPPDATA 'todo-list-android'
$taskUri = [uri]$ApiOrigin
if ($taskUri.Scheme -notin @('http', 'https') -or $taskUri.AbsolutePath -ne '/' -or $taskUri.Query -or $taskUri.UserInfo -or $taskUri.Fragment) {
    throw 'ApiOrigin 必须是服务器根地址，例如 https://todo.example.com'
}
$ApiOrigin = $taskUri.GetLeftPart([System.UriPartial]::Authority)
if ($taskUri.Scheme -eq 'http' -and $taskUri.Host -ne '103.236.96.53') {
    throw '测试包只为现有服务器允许 HTTP。其他服务器请使用 HTTPS，或修改 debug_network_security.xml。'
}
if (!$JavaHome) {
    if (Test-Path (Join-Path $taskTools 'java')) { $JavaHome = (Get-ChildItem (Join-Path $taskTools 'java') -Directory | Select-Object -First 1).FullName }
    else { $JavaHome = $env:JAVA_HOME }
}
if (!$AndroidSdk) {
    if (Test-Path (Join-Path $taskTools 'sdk')) { $AndroidSdk = Join-Path $taskTools 'sdk' }
    elseif ($env:ANDROID_HOME) { $AndroidSdk = $env:ANDROID_HOME }
    else { $AndroidSdk = $env:ANDROID_SDK_ROOT }
}
if (!$JavaHome -or !(Test-Path (Join-Path $JavaHome 'bin\java.exe'))) { throw '需要 JDK 21；可通过 -JavaHome 指定目录。' }
if (!$AndroidSdk -or !(Test-Path (Join-Path $AndroidSdk 'platforms\android-36\android.jar'))) { throw '需要 Android SDK Platform 36；可通过 -AndroidSdk 指定目录。' }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $taskRoot 'tmp\releases\android' }
$taskOldJava = $env:JAVA_HOME; $taskOldSdk = $env:ANDROID_HOME; $taskOldPath = $env:PATH; $taskOldOrigin = $env:VITE_API_ORIGIN
Push-Location $taskFrontend
try {
    $env:JAVA_HOME = $JavaHome; $env:ANDROID_HOME = $AndroidSdk
    $env:PATH = (Join-Path $JavaHome 'bin') + ';' + $env:PATH
    $env:VITE_API_ORIGIN = $ApiOrigin
    $taskJavaVersion = & (Join-Path $JavaHome 'bin\java.exe') -version 2>&1 | Out-String
    if ($taskJavaVersion -notmatch 'version "(2[1-9]|[3-9][0-9])\.') { throw '安卓构建需要 JDK 21 或更新版本。' }
    if (!(Test-Path 'node_modules\@capacitor\cli')) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
    }
    & npm.cmd run build:android
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
    & npx.cmd cap sync android
    if ($LASTEXITCODE -ne 0) { throw '安卓资源同步失败' }
    $taskSdkPath = $AndroidSdk.Replace('\', '/').Replace(':', '\:')
    Set-Content -LiteralPath 'android\local.properties' -Value ('sdk.dir=' + $taskSdkPath)
    Push-Location 'android'
    try {
        # Recreate the app package so removed assets do not leave gaps in the incremental APK ZIP.
        & .\gradlew.bat :app:clean :app:assembleDebug --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'APK 构建失败' }
    } finally { Pop-Location }
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $taskApk = Join-Path $OutputDirectory ('小狒待办-Android-测试版-' + (Get-Date -Format 'yyyyMMdd') + '.apk')
    Copy-Item -LiteralPath 'android\app\build\outputs\apk\debug\app-debug.apk' -Destination $taskApk -Force
    Get-FileHash -LiteralPath $taskApk -Algorithm SHA256
    Write-Output ('安装包：' + $taskApk)
} finally {
    Pop-Location
    $env:JAVA_HOME = $taskOldJava; $env:ANDROID_HOME = $taskOldSdk; $env:PATH = $taskOldPath; $env:VITE_API_ORIGIN = $taskOldOrigin
}
