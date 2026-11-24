[CmdletBinding()]
param(
    [ValidateSet('all', 'core', 'ui', 'integration', 'wake-native', 'boundary', 'package', 'resolution')]
    [string]$Suite = 'all',
    [string]$NodeExecutable = $env:DSH_NODE_EXECUTABLE,
    [string]$InstallDir = $env:DSH_INSTALL_DIR,
    [string]$SharedNodePath = '',
    [string]$PackageRoot = $env:TEAMWORK_PACKAGE_ROOT,
    [ValidateRange(1, 600)][int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $NodeExecutable -or -not $InstallDir) { throw 'Use a DSH Desktop session, or pass -NodeExecutable and -InstallDir for a compatible Desktop installation.' }
if (-not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf)) { throw 'DSH Node executable does not exist.' }
# Do not Test-Path the installation manifest: Desktop's ASAR-aware runtime can read
# virtual package paths which native PowerShell filesystem commands cannot.
# Desktop exposes its shared installation through this anchor. Override for a different layout.
if (-not $SharedNodePath) { $SharedNodePath = [System.IO.Path]::GetFullPath((Join-Path $InstallDir '../..')) }
$runtime = Join-Path $root 'tests/.runtime'
$results = Join-Path $root 'tests/.results'
$null = New-Item -ItemType Directory -Force -Path $runtime, $results
$expected = [ordered]@{ core = 78; ui = 72; integration = 26; 'wake-native' = 8; boundary = 3; package = 10; resolution = 1 }
$suites = if ($Suite -eq 'all') { @($expected.Keys) } else { @($Suite) }
if ($PackageRoot -and $Suite -ne 'resolution') { throw '-PackageRoot / TEAMWORK_PACKAGE_ROOT is a separate archive resolver check; use -Suite resolution.' }
$counts = [ordered]@{}
$runId = [guid]::NewGuid().ToString('N')
foreach ($name in $suites) {
    Write-Host "--- $name ---"
    $scriptPath = Join-Path $root "tests/$name.cjs"
    $start = [System.Diagnostics.ProcessStartInfo]::new($NodeExecutable)
    $start.Arguments = '"' + $scriptPath + '"'
    $start.WorkingDirectory = $root
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $start.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $start.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $start.EnvironmentVariables['DSH_INSTALL_DIR'] = $InstallDir
    if ($PackageRoot) { $start.EnvironmentVariables['TEAMWORK_PACKAGE_ROOT'] = $PackageRoot }
    $start.EnvironmentVariables['NODE_PATH'] = $SharedNodePath
    foreach ($key in @('DSH_HOME', 'DSH_PROFILE_DIR', 'TMP', 'TEMP')) { $start.EnvironmentVariables[$key] = $runtime }
    $start.EnvironmentVariables['DSH_PROFILE'] = 'isolated-test-fixture'
    $startedAt = [datetime]::UtcNow
    $process = [System.Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill(); $process.WaitForExit()
        [Console]::Out.Write($stdout.GetAwaiter().GetResult())
        [Console]::Error.Write($stderr.GetAwaiter().GetResult())
        $process.Dispose()
        throw "Suite $name exceeded its timeout; no passing evidence is produced."
    }
    [Console]::Out.Write($stdout.GetAwaiter().GetResult())
    [Console]::Error.Write($stderr.GetAwaiter().GetResult())
    $code = $process.ExitCode
    $process.Dispose()
    if ($code -ne 0) { throw "Suite $name failed with exit code $code" }
    $resultName = if ($PackageRoot) { 'resolution-archive' } else { $name }
    $resultPath = Join-Path $results "$resultName.json"
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) { throw "Missing fresh result for $name" }
    if ((Get-Item -LiteralPath $resultPath).LastWriteTimeUtc -lt $startedAt) { throw "Stale result for $name" }
    $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
    if ($name -eq 'resolution') {
        if ($result.passed -ne $true -or $result.nodePathAbsent -ne $true) { throw 'Resolver proof failed.' }
        $counts[$resultName] = 1
    } else {
        if ($result.failed -ne 0 -or $result.passed -ne $expected[$name]) { throw "Unexpected check count or failure for $name" }
        $counts[$name] = $result.passed
    }
}
$total = ($counts.Values | Measure-Object -Sum).Sum
$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
$hashes = [ordered]@{}
foreach ($file in @('package.json', 'index.js', 'client.cjs', 'cordis.patch.yml') + @(Get-ChildItem -LiteralPath (Join-Path $root 'lib') -File | ForEach-Object { 'lib/' + $_.Name })) {
    $hashes[$file] = (Get-FileHash -LiteralPath (Join-Path $root $file) -Algorithm SHA256).Hash.ToLowerInvariant()
}
$summary = [ordered]@{ runId = $runId; version = $manifest.version; completedAtUtc = [datetime]::UtcNow.ToString('o'); suite = $Suite; counts = $counts; total = $total; sourceHashes = $hashes; profileInstallationAttempted = $false; browserRenderingVerified = $false; limits = @('Windows Desktop runtime tested only.', 'Scripted models only; no external-model or real-user acceptance.', 'Resolver uses isolated linked-root composition, not a physical profile install.') }
$summaryName = if ($PackageRoot) { 'resolution-archive' } else { $Suite }
$summary | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $results "$summaryName-summary.json")
Write-Host "PASS $total checks ($Suite); isolated results: tests/.results"
