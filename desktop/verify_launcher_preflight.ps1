param([Parameter(Mandatory=$true)][string]$PortableRoot)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PortableRoot).Path
$exe = Join-Path $root 'RHODA.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Portable launcher not found: $exe" }
$id = [guid]::NewGuid().ToString('N')
$configPath = Join-Path $root ".preflight-$id.json"
$dataDir = Join-Path $root "data\preflight-$id"
$probe = $null
$occupied = $null

function Get-AvailableTestPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port }
    finally { $listener.Stop() }
}

function Invoke-Check([string]$Path) {
    $output = & $exe --config $Path --check 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    try { $result = $output | ConvertFrom-Json }
    catch { throw "Launcher preflight did not return JSON (exit $exitCode): $output" }
    return @{ ExitCode=$exitCode; Result=$result }
}

try {
    $port = Get-AvailableTestPort
    $config = [ordered]@{
        projectRoot='.'; resourceRoot='resources'; port=$port
        pythonPath='runtime/python.exe'; dataDir=("data\preflight-$id"); portable=$true
    }
    $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

    $free = Invoke-Check $configPath
    if ($free.ExitCode -ne 0 -or -not $free.Result.ok -or -not $free.Result.portAvailable) {
        throw "A free-port portable preflight should pass: $($free.Result | ConvertTo-Json -Compress)"
    }
    if ($free.Result.requiresLocalPythonEnvironment -or -not $free.Result.pythonBundled) {
        throw 'Portable preflight misreported the bundled Python runtime.'
    }

    $occupied = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    $occupied.Start()
    $busy = Invoke-Check $configPath
    if ($busy.ExitCode -eq 0 -or $busy.Result.ok -or $busy.Result.portAvailable) {
        throw "A conflicting listener must fail preflight: $($busy.Result | ConvertTo-Json -Compress)"
    }
    if (-not ($busy.Result.problems -match 'Local port .* already in use by another process')) {
        throw "Preflight did not explain the port conflict: $($busy.Result | ConvertTo-Json -Compress)"
    }

    [pscustomobject]@{
        freePortCheck='PASS'
        occupiedPortCheck='PASS'
        bundledPythonCheck='PASS'
        diagnostic=$busy.Result.problems[0]
    }
}
finally {
    if ($occupied) { $occupied.Stop() }
    if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
    if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force }
}
