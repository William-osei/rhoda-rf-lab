param(
    [Parameter(Mandatory=$true)][string]$ResourceRoot,
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
    [string]$OutputDirectory = (Join-Path ([IO.Path]::GetPathRoot($PSScriptRoot)) ('RHODA-Portable-Build-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))),
    [switch]$IncludeLocalDocuments
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$resources = (Resolve-Path -LiteralPath $ResourceRoot).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
$app = Join-Path $output 'RHODA-Portable'
$runtimeCache = Join-Path $output 'python-3.13.16-embed-amd64.zip'
$archive = Join-Path $output 'RHODA-Portable-Windows-x64.zip'
$pythonUrl = 'https://www.python.org/ftp/python/3.13.16/python-3.13.16-embed-amd64.zip'
$pythonSha256 = '97DAE5274CC54867065E8D5A3226E48C35017ED332A0FDB0E27D5B5821961297'

if (Test-Path -LiteralPath $output) { throw "Output folder already exists; choose a fresh -OutputDirectory: $output" }
if (-not (Test-Path -LiteralPath (Join-Path $project 'desktop\bin\RHODA.exe'))) { throw 'Build the launcher first with desktop/build.ps1.' }
foreach ($page in @('desktop.html','index.html','chat.html','library.html','practice.html','spatial-bench.html','instruments.html','instructor.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $project "dist\$page"))) { throw "Built app is missing dist/$page. Run npm run build first." }
}
if (-not (Test-Path -LiteralPath (Join-Path $resources '00-START-HERE\catalog\documents.json'))) { throw 'ResourceRoot must contain the local document catalog.' }
if (Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue) { Write-Warning 'Port 8765 is currently in use; use another port in the portable configuration before launching both apps together.' }

New-Item -ItemType Directory -Path $app -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $project 'dist') -Destination $app -Recurse
New-Item -ItemType Directory -Path (Join-Path $app 'desktop'),(Join-Path $app 'server'),(Join-Path $app 'resources'),(Join-Path $app 'runtime\Lib\site-packages') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $project 'desktop\server.py') -Destination (Join-Path $app 'desktop\server.py')
Copy-Item -LiteralPath (Join-Path $project 'desktop\bin\RHODA.exe') -Destination (Join-Path $app 'RHODA.exe')
Copy-Item -LiteralPath (Join-Path $project 'desktop\rhoda.ico') -Destination (Join-Path $app 'rhoda.ico')
Copy-Item -LiteralPath (Join-Path $project 'desktop\rhoda-splash.png') -Destination (Join-Path $app 'rhoda-splash.png')
Copy-Item -LiteralPath (Join-Path $project 'desktop\requirements-portable.txt') -Destination (Join-Path $app 'requirements-portable.txt')
$backend = Join-Path $project 'server'
Get-ChildItem -LiteralPath $backend -File -Filter '*.py' | Copy-Item -Destination (Join-Path $app 'server')
Copy-Item -LiteralPath (Join-Path $backend 'instrument') -Destination (Join-Path $app 'server') -Recurse

if (-not (Test-Path -LiteralPath $runtimeCache)) {
    Write-Output 'Downloading the pinned official Python embeddable runtime (64-bit)…'
    Invoke-WebRequest -Uri $pythonUrl -OutFile $runtimeCache
}
$actualSha256 = (Get-FileHash -LiteralPath $runtimeCache -Algorithm SHA256).Hash
if ($actualSha256 -ne $pythonSha256) { throw "Official Python runtime checksum mismatch: $actualSha256" }
Expand-Archive -LiteralPath $runtimeCache -DestinationPath (Join-Path $app 'runtime')
$pth = Get-ChildItem -LiteralPath (Join-Path $app 'runtime') -Filter 'python313._pth' -File | Select-Object -First 1
if (-not $pth) { throw 'The pinned Python archive did not contain python313._pth.' }
@('python313.zip','.','Lib','Lib\site-packages','import site') | Set-Content -LiteralPath $pth.FullName -Encoding ASCII

$buildPython = Join-Path $project '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $buildPython)) { throw 'The local build environment is missing .venv/Scripts/python.exe.' }
$sitePackages = Join-Path $app 'runtime\Lib\site-packages'
Write-Output 'Installing only the pinned offline Flask simulator dependencies for CPython 3.13 / Windows x64…'
& $buildPython -B -m pip install --disable-pip-version-check --no-warn-script-location --no-compile --target $sitePackages --platform win_amd64 --python-version 3.13 --implementation cp --abi cp313 --only-binary=:all: -r (Join-Path $project 'desktop\requirements-portable.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not assemble the portable Python dependency set.' }

$runtimePython = Join-Path $app 'runtime\python.exe'
$version = & $runtimePython -B -c 'import sys; print(sys.version.split()[0])'
if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne '3.13.16') { throw "Packaged Python failed its isolation check: $version" }
$dependencyReport = & $runtimePython -B -c "import importlib.metadata as m,json; items=({'name':d.metadata['Name'],'version':d.version,'license':d.metadata.get('License-Expression') or d.metadata.get('License') or 'See bundled package metadata'} for d in m.distributions()); print(json.dumps(sorted(items,key=lambda x:x['name'].lower()),indent=2))"
if ($LASTEXITCODE -ne 0) { throw 'Could not read the portable runtime dependency metadata.' }
$dependencyReport | Set-Content -LiteralPath (Join-Path $app 'PYTHON-DEPENDENCIES.json') -Encoding UTF8

$serverFiles = Get-ChildItem -LiteralPath (Join-Path $app 'server') -Recurse -File -Filter '*.py' | ForEach-Object { $_.FullName.Substring((Join-Path $app 'server').Length + 1) }
if ($serverFiles -notcontains 'app.py' -or $serverFiles -notcontains 'library.py' -or $serverFiles -notcontains 'instrument\backends.py') { throw 'Portable backend source inventory is incomplete.' }

if ($IncludeLocalDocuments) {
    Write-Warning 'This package includes the local document copies and extracted text. Confirm distribution rights before sharing it.'
    Write-Output 'Copying only the original catalog entries and extracted text needed by the local library…'
    $copyPlanPath = Join-Path $output 'resource-copy-plan.py'
    @'
import json, pathlib, shutil, sys
source, destination = map(pathlib.Path, sys.argv[1:3])
catalog = source / '00-START-HERE/catalog/documents.json'
entries = json.loads(catalog.read_text(encoding='utf-8'))
additions = source / '00-START-HERE/catalog/official-additions.json'
if additions.is_file(): entries += json.loads(additions.read_text(encoding='utf-8'))
seen = set(); files = {'00-START-HERE/catalog/documents.json'}
if additions.is_file(): files.add('00-START-HERE/catalog/official-additions.json')
for item in entries:
    relative = item['path']
    if not (relative.startswith('RHODES AND SCHWARZE/') or relative.startswith('Lab-assistant/') or relative == 'Rhoda_Technical_Report.pdf'): continue
    if item.get('sha256') in seen: continue
    seen.add(item.get('sha256'))
    files.add(relative)
    text = item.get('extracted_text')
    if text: files.add(text)
missing = [name for name in sorted(files) if not (source / name).is_file()]
if missing: raise SystemExit('Missing local resource files: ' + ', '.join(missing[:10]))
for name in sorted(files):
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / name, target)
print(json.dumps({'catalogEntries':len(entries),'documents':len(seen),'files':len(files),'bytes':sum((destination / n).stat().st_size for n in files)},indent=2))
'@ | Set-Content -LiteralPath $copyPlanPath -Encoding UTF8
    $copyReport = & $buildPython -B $copyPlanPath $resources (Join-Path $app 'resources')
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the local catalog and document set.' }
    $copyReport | Set-Content -LiteralPath (Join-Path $app 'RESOURCE-PACKAGE.json') -Encoding UTF8
} else {
    Write-Output 'Building the team-pilot variant without local R&S manuals, project reports, or extracted document text…'
    $catalogDirectory = Join-Path $app 'resources\00-START-HERE\catalog'
    New-Item -ItemType Directory -Path $catalogDirectory -Force | Out-Null
    '[]' | Set-Content -LiteralPath (Join-Path $catalogDirectory 'documents.json') -Encoding ascii -NoNewline
    [ordered]@{catalogEntries=0;documents=0;files=1;bytes=2;note='No local vendor documents are included. Add only organization-authorized documents.'} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'RESOURCE-PACKAGE.json') -Encoding UTF8
}

$configuration = [ordered]@{projectRoot='.';resourceRoot='resources';port=8765;pythonPath='runtime/python.exe';dataDir='data';portable=$true}
$configuration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'rhoda-desktop.json') -Encoding UTF8
@'
@echo off
setlocal
start "" "%~dp0RHODA.exe" --config "%~dp0rhoda-desktop.json" --data-dir "%~dp0data"
'@ | Set-Content -LiteralPath (Join-Path $app 'Start RHODA.cmd') -Encoding ASCII
$readme = @'
RHODA Portable for Windows x64

Extract this folder into a short, writable path and double-click Start RHODA.cmd.
The app keeps its browser profile, preferences, and local training records in
the data folder beside this launcher, so moving the complete folder preserves
those files. Do not run the same portable folder from two computers at once.

The folder bundles the app, simulated Flask service, private CPython 3.13.16
runtime. It never enables cloud AI or probes real instrument hardware.
Microsoft Edge and .NET Framework 4.8 must be present for the app window and
native launcher. This is a Windows x64 portable folder, not a signed
MSI/setup wizard, and it has only been tested on the build PC so far.

Python and the pinned Flask dependencies are included with license metadata in
PYTHON-DEPENDENCIES.json and the runtime package files.
'@
if ($IncludeLocalDocuments) {
    $readme += @'

This personal-evaluation variant also includes the local project catalog's
Rohde & Schwarz documents and extracted text. The published R&S website terms
describe downloaded copies as personal-use downloads and reserve commercial
use without a separate licence. Do not share this document pack or use it
commercially unless you have confirmed written permission for every included
file. See https://www.rohde-schwarz.com/us/general-information/terms-of-website-use_101516.html
'@
} else {
    $readme += @'

No manufacturer manuals, project reports, or extracted third-party document
text are bundled in this team-pilot variant. RHODA-authored fundamentals,
study paths, exercises and official source links remain available. The local
document search starts empty; an administrator can add only documents the
organization is authorized to store and use offline.
'@
}
$readme | Set-Content -LiteralPath (Join-Path $app 'READ ME.txt') -Encoding UTF8

$pythonLicense = Get-ChildItem -LiteralPath (Join-Path $app 'runtime') -File -Filter '*LICENSE*' | Select-Object -First 1
if ($pythonLicense) { Copy-Item -LiteralPath $pythonLicense.FullName -Destination (Join-Path $app 'PYTHON-LICENSE.txt') }
$appBytes = (Get-ChildItem -LiteralPath $app -Recurse -File | Measure-Object Length -Sum).Sum
$appMb = [math]::Round($appBytes / 1MB, 1)
Write-Output "STAGED_PORTABLE_BYTES=$appBytes STAGED_PORTABLE_MB=$appMb PYTHON=$($version.Trim())"
Write-Output 'Creating the portable ZIP; document PDFs are already compressed and this can take a few minutes.'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($app, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
Write-Output "PORTABLE_FOLDER=$app"
Write-Output "PORTABLE_ZIP=$archive"
