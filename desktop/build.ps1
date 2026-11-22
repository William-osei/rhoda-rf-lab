param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'bin'))
$ErrorActionPreference = 'Stop'
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$frameworkPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path -LiteralPath $frameworkPath -PathType Container)) {
    $frameworkPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'
}
$compilerCandidates = @(
    'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe',
    (Join-Path $frameworkPath 'csc.exe')
)
$compilerPath = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compilerPath) { throw 'No installed C# compiler was found. This build does not download or install a toolchain.' }
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$iconPath = Join-Path $PSScriptRoot 'rhoda.ico'
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { & (Join-Path $PSScriptRoot 'generate-icon.ps1') }
$manifestPath = Join-Path $outputPath 'rhoda.manifest'
@'
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="RHODA.Desktop" />
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false" /></requestedPrivileges></security></trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings><dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware></windowsSettings></application>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" /></application></compatibility>
</assembly>
'@ | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$references = @('mscorlib.dll','System.dll','System.Core.dll','System.Windows.Forms.dll','System.Drawing.dll','System.Web.Extensions.dll','System.Management.dll')
$binaryPath = Join-Path $outputPath 'RHODA.exe'
$compilerArguments = @('/nologo','/noconfig','/nostdlib+','/target:winexe','/platform:anycpu','/langversion:5','/optimize+','/warn:4',"/out:$binaryPath","/win32icon:$iconPath","/win32manifest:$manifestPath")
foreach ($reference in $references) {
    $referencePath = Join-Path $frameworkPath $reference
    if (-not (Test-Path -LiteralPath $referencePath -PathType Leaf)) { throw "Missing installed .NET Framework assembly: $reference" }
    $compilerArguments += "/reference:$referencePath"
}
$compilerArguments += Join-Path $PSScriptRoot 'RhodaLauncher.cs'
& $compilerPath @compilerArguments
if ($LASTEXITCODE -ne 0) { throw "C# compilation failed (exit $LASTEXITCODE)." }
Write-Output "Built $binaryPath using the installed .NET Framework assemblies."
Write-Output 'The installed launcher uses the local Python environment; the separate portable build bundles Python. Both use Microsoft Edge.'
