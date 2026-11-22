$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourcePath = Join-Path $PSScriptRoot 'rhoda-user-icon.png'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw 'The supplied RHODA icon asset is missing: rhoda-user-icon.png'
}
$frames = New-Object 'System.Collections.Generic.List[byte[]]'
$sizes = @(16,32,48,256)
$source = [Drawing.Image]::FromFile($sourcePath)
try {
    foreach ($size in $sizes) {
        $bitmap = New-Object Drawing.Bitmap($size,$size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.DrawImage($source, 0, 0, $size, $size)
        $stream = New-Object IO.MemoryStream
        $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
        $frames.Add($stream.ToArray())
        if ($size -eq 256) { $bitmap.Save((Join-Path $PSScriptRoot 'rhoda.png'),[Drawing.Imaging.ImageFormat]::Png) }
        $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    }
} finally {
    $source.Dispose()
}
$iconFile = [IO.File]::Create((Join-Path $PSScriptRoot 'rhoda.ico'))
$writer = New-Object IO.BinaryWriter($iconFile)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16*$sizes.Count
    for ($index=0; $index -lt $sizes.Count; $index++) {
        $dimension = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frames[$index].Length); $writer.Write([uint32]$offset)
        $offset += $frames[$index].Length
    }
    foreach ($frame in $frames) { $writer.Write($frame) }
} finally { $writer.Dispose(); $iconFile.Dispose() }
Write-Output 'Generated RHODA ICO from supplied R&S icon artwork.'
