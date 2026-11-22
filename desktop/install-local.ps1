param(
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
    [ValidateRange(1024,65535)][int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
$workspacePath = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
$projectPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$binaryPath = Join-Path $PSScriptRoot 'bin\RHODA.exe'
if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
    throw 'Build the launcher first: powershell -File desktop/build.ps1'
}
foreach ($entry in @('desktop.html','index.html','chat.html','library.html','practice.html','spatial-bench.html','instruments.html','instructor.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectPath "dist\$entry") -PathType Leaf)) {
        throw "The built app is missing $entry. Run npm run build in the active project."
    }
}
$appDirectory = Join-Path $workspacePath 'RHODA App'
New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null
Copy-Item -LiteralPath $binaryPath -Destination (Join-Path $appDirectory 'RHODA.exe') -Force
$iconPath = Join-Path $PSScriptRoot 'rhoda.ico'
if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
    Copy-Item -LiteralPath $iconPath -Destination (Join-Path $appDirectory 'rhoda.ico') -Force
}
$iconPreviewPath = Join-Path $PSScriptRoot 'rhoda-user-icon.png'
if (Test-Path -LiteralPath $iconPreviewPath -PathType Leaf) {
    Copy-Item -LiteralPath $iconPreviewPath -Destination (Join-Path $appDirectory 'RHODA-icon.png') -Force
}
$splashPath = Join-Path $PSScriptRoot 'rhoda-splash.png'
if (Test-Path -LiteralPath $splashPath -PathType Leaf) {
    Copy-Item -LiteralPath $splashPath -Destination (Join-Path $appDirectory 'rhoda-splash.png') -Force
}
$displayMode = 'borderless'
$existingConfigurationPath = Join-Path $appDirectory 'rhoda-desktop.json'
if (Test-Path -LiteralPath $existingConfigurationPath -PathType Leaf) {
    try {
        $existingConfiguration = Get-Content -LiteralPath $existingConfigurationPath -Raw | ConvertFrom-Json
        if ($existingConfiguration.displayMode -in @('windowed', 'borderless', 'fullscreen')) {
            $displayMode = $existingConfiguration.displayMode
        }
    } catch {
        Write-Warning 'Existing desktop configuration could not be read; resetting display mode to borderless.'
    }
}
$configuration = [ordered]@{projectRoot=$projectPath;resourceRoot=$workspacePath;port=$Port;displayMode=$displayMode}
$configuration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appDirectory 'rhoda-desktop.json') -Encoding UTF8
$shortcutPath = Join-Path $workspacePath 'Launch RHODA.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $appDirectory 'RHODA.exe'
$shortcut.WorkingDirectory = $appDirectory
$shortcut.Description = 'Open RHODA chat, resources and virtual lab'
$shortcut.IconLocation = "$(Join-Path $appDirectory 'rhoda.ico'),0"
$shortcut.WindowStyle = 1
$shortcut.Save()
@'
RHODA — Lab Companion

Double-click RHODA.exe here, or Launch RHODA in the parent R&S folder.
The app opens its home screen and starts its own offline local service.
Close its windows to stop the service; the tray menu also has an Exit option.

Chat, spatial studio, practice, 3D instrument, resources and session records
are available together. Internal section links stay in the app window.
This entry point uses the existing RHODA-Development checkout and Python
environment on this PC. Keep that checkout and its dist folder in place.
It is not yet a portable installer for other PCs.

See RHODA-Development/DESKTOP-APP.md in the parent folder for setup,
rebuilding, data locations and troubleshooting.
'@ | Set-Content -LiteralPath (Join-Path $appDirectory 'READ ME.txt') -Encoding UTF8
Write-Output "App: $(Join-Path $appDirectory 'RHODA.exe')"
Write-Output "Shortcut: $shortcutPath"
