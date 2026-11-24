param([switch]$Check, [string]$NodeExecutable = $env:DSH_NODE_EXECUTABLE)
$ErrorActionPreference = 'Stop'
if (-not $NodeExecutable) { throw 'Pass -NodeExecutable (Node >=24.9.0), or run from the DSH environment.' }
$root = Split-Path -Parent $PSScriptRoot
$start = [System.Diagnostics.ProcessStartInfo]::new($NodeExecutable)
$start.Arguments = '"' + (Join-Path $PSScriptRoot 'build-release.cjs') + '"'
if ($Check) { $start.Arguments += ' --check' }
$start.WorkingDirectory = $root
$start.UseShellExecute = $false
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$start.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$start.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
$process = [System.Diagnostics.Process]::Start($start)
$stdout = $process.StandardOutput.ReadToEndAsync()
$stderr = $process.StandardError.ReadToEndAsync()
if (-not $process.WaitForExit(60000)) { $process.Kill(); $process.WaitForExit(); throw 'Release build exceeded 60 seconds.' }
[Console]::Out.Write($stdout.GetAwaiter().GetResult())
[Console]::Error.Write($stderr.GetAwaiter().GetResult())
$code = $process.ExitCode
$process.Dispose()
if ($code -ne 0) { throw "Release build/check failed with exit code $code" }
