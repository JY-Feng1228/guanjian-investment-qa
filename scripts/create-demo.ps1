#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$OutputPath,
    [switch]$TechnicalTest
)

$ErrorActionPreference = 'Stop'
$invariant = [Globalization.CultureInfo]::InvariantCulture
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
$fontPath = 'C:\Windows\Fonts\msyh.ttc'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stagingRoot = Join-Path $projectRoot 'outputs\demo-staging'

function Invoke-MediaCommand([string]$program, [string[]]$commandArgs, [string]$step) {
    $output = & $program @commandArgs 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $tail = ($output -split '\r?\n' | Select-Object -Last 12) -join [Environment]::NewLine
        throw "$step failed (exit $exitCode).`n$tail"
    }
    return $output
}

function Get-MediaInfo([string]$path) {
    $json = Invoke-MediaCommand $ffprobe @(
        '-v', 'error', '-show_entries',
        'format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,sample_rate,channels',
        '-of', 'json', $path
    ) 'ffprobe'
    return ($json | ConvertFrom-Json)
}

function Write-Utf8([string]$path, [string]$text) {
    [IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))
}

function Get-CaptionLines([string]$text, [Drawing.Font]$font, [Drawing.Graphics]$graphics) {
    $lines = [Collections.Generic.List[string]]::new()
    foreach ($paragraph in ($text -split '\r?\n')) {
        $line = ''
        $elements = [Globalization.StringInfo]::GetTextElementEnumerator($paragraph.Trim())
        while ($elements.MoveNext()) {
            $element = $elements.GetTextElement()
            $candidate = $line + $element
            if ($line.Length -gt 0 -and $graphics.MeasureString($candidate, $font).Width -gt 1352) {
                $lines.Add($line.Trim())
                $line = $element
            } else {
                $line = $candidate
            }
        }
        if ($line.Trim().Length -gt 0) { $lines.Add($line.Trim()) }
    }
    if ($lines.Count -eq 0 -or $lines.Count -gt 2) { throw 'Caption must fit one or two lines; shorten this scene caption.' }
    return ,$lines.ToArray()
}

if (-not [IO.Path]::IsPathFullyQualified($ManifestPath) -or -not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw 'ManifestPath must be an existing absolute local file path.'
}
if (-not [IO.Path]::IsPathFullyQualified($OutputPath) -or [IO.Path]::GetExtension($OutputPath) -ine '.mp4') {
    throw 'OutputPath must be an absolute .mp4 path.'
}
if (Test-Path -LiteralPath $OutputPath) { throw 'Output already exists; choose a new path. Existing files are never overwritten.' }
if (-not (Test-Path -LiteralPath $fontPath -PathType Leaf)) { throw 'Microsoft YaHei font file was not found.' }

$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 10
if (-not $manifest.scenes -or @($manifest.scenes).Count -gt 20) { throw 'Manifest requires 1 to 20 scenes.' }
foreach ($scene in $manifest.scenes) {
    foreach ($field in @('image', 'title', 'caption', 'narration')) {
        if ($scene.$field -isnot [string] -or [string]::IsNullOrWhiteSpace($scene.$field)) { throw "Each scene requires nonempty string field: $field" }
    }
    if (-not [IO.Path]::IsPathFullyQualified($scene.image) -or -not (Test-Path -LiteralPath $scene.image -PathType Leaf)) {
        throw 'Each image must be an existing absolute local screenshot path.'
    }
    if ($scene.title -match '[\r\n]' -or $scene.title.Length -gt 80) { throw 'Scene title must be a short single line.' }
}

Add-Type -AssemblyName System.Drawing
$runDirectory = Join-Path $stagingRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
Copy-Item -LiteralPath $fontPath -Destination (Join-Path $runDirectory 'msyh.ttc')
$fontCollection = [Drawing.Text.PrivateFontCollection]::new()
$fontCollection.AddFontFile($fontPath)
$titleFont = [Drawing.Font]::new($fontCollection.Families[0], 28, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$captionFont = [Drawing.Font]::new($fontCollection.Families[0], 24, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$bitmap = [Drawing.Bitmap]::new(1, 1)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$speaker = $null
$voiceTokens = $null
$prepared = [Collections.Generic.List[object]]::new()

try {
    $speaker = New-Object -ComObject SAPI.SpVoice
    $voiceTokens = $speaker.GetVoices()
    $voice = $null
    foreach ($token in $voiceTokens) {
        if ($token.GetDescription() -eq 'Microsoft Huihui Desktop - Chinese (Simplified)') { $voice = $token; break }
    }
    if (-not $voice) { throw 'Microsoft Huihui Desktop Chinese voice is required; no software will be installed.' }
    $speaker.Voice = $voice
    $speaker.Rate = 0
    $speaker.Volume = 100

    $index = 0
    foreach ($scene in $manifest.scenes) {
        $index++
        $name = 'scene-{0:D3}' -f $index
        $title = '本机交互截帧演示 | SAPI 合成旁白 | ' + $scene.title.Trim()
        if ($graphics.MeasureString($title, $titleFont).Width -gt 1352) { throw "Scene $index title is too long for the footer." }
        $captionLines = Get-CaptionLines $scene.caption $captionFont $graphics
        Write-Utf8 (Join-Path $runDirectory "$name-title.txt") $title
        Write-Utf8 (Join-Path $runDirectory "$name-caption-1.txt") $captionLines[0]
        Write-Utf8 (Join-Path $runDirectory "$name-caption-2.txt") $(if ($captionLines.Count -gt 1) { $captionLines[1] } else { '' })

        $wav = Join-Path $runDirectory "$name.wav"
        $stream = New-Object -ComObject SAPI.SpFileStream
        try {
            $stream.Format.Type = 22 # 22.05 kHz, 16-bit mono WAV.
            $stream.Open($wav, 3, $false)
            $speaker.AudioOutputStream = $stream
            $null = $speaker.Speak($scene.narration, 16) # Plain text, not SAPI XML.
        } finally {
            $stream.Close()
            [Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream) | Out-Null
        }
        if ((Get-Item -LiteralPath $wav).Length -le 44) { throw "Scene $index narration is empty." }
        $audioInfo = Get-MediaInfo $wav
        $audioSeconds = [double]::Parse($audioInfo.format.duration, $invariant)
        if ($audioSeconds -le 0 -or -not @($audioInfo.streams | Where-Object codec_type -eq 'audio').Count) {
            throw "Scene $index has no valid audio stream."
        }
        $frames = [int][Math]::Ceiling([Math]::Max(6.0, $audioSeconds + 1.0) * 30)
        $prepared.Add([pscustomobject]@{
            name = $name; image = $scene.image; imageSha256 = (Get-FileHash -LiteralPath $scene.image -Algorithm SHA256).Hash;
            title = $scene.title; audioSeconds = $audioSeconds; seconds = $frames / 30.0; frames = $frames
        })
        Write-Output ('Scene {0}: WAV {1:F2}s, clip {2:F2}s.' -f $index, $audioSeconds, ($frames / 30.0))
    }
} finally {
    if ($speaker) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($speaker) | Out-Null }
    if ($voiceTokens) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($voiceTokens) | Out-Null }
    $graphics.Dispose()
    $bitmap.Dispose()
    $titleFont.Dispose()
    $captionFont.Dispose()
    $fontCollection.Dispose()
}

$expectedSeconds = ($prepared | Measure-Object -Property seconds -Sum).Sum
if (-not $TechnicalTest -and ($expectedSeconds -lt 60 -or $expectedSeconds -gt 180)) {
    throw ('Planned duration is {0:F2}s; final demos must be 60-180s. Adjust narration/scenes. Use -TechnicalTest only for a short technical check.' -f $expectedSeconds)
}
Write-Output ('Planned duration: {0:F2}s. Staging: {1}' -f $expectedSeconds, $runDirectory)

Push-Location -LiteralPath $runDirectory
try {
    foreach ($scene in $prepared) {
        # Text files avoid escaping user text inside ffmpeg filters. The screenshot is never cropped.
        $filter = @(
            'scale=1440:1000:force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv',
            'pad=1440:1120:(ow-iw)/2:(1000-ih)/2:color=0xF2F5F6',
            'setsar=1',
            'format=yuv420p',
            'setparams=range=limited',
            'drawbox=x=0:y=1000:w=1440:h=120:color=0x10383A:t=fill',
            "drawtext=fontfile=msyh.ttc:textfile=$($scene.name)-title.txt:expansion=none:fontcolor=white:fontsize=28:x=44:y=1010",
            "drawtext=fontfile=msyh.ttc:textfile=$($scene.name)-caption-1.txt:expansion=none:fontcolor=0xE1EEEE:fontsize=24:x=44:y=1050",
            "drawtext=fontfile=msyh.ttc:textfile=$($scene.name)-caption-2.txt:expansion=none:fontcolor=0xE1EEEE:fontsize=24:x=44:y=1082"
        ) -join ','
        $null = Invoke-MediaCommand $ffmpeg @(
            '-hide_banner', '-loglevel', 'warning', '-nostdin', '-n',
            '-loop', '1', '-framerate', '30', '-i', $scene.image, '-i', "$($scene.name).wav",
            '-map', '0:v:0', '-map', '1:a:0', '-vf', $filter, '-af', 'apad',
            '-t', $scene.seconds.ToString('F6', $invariant), '-r', '30',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-color_range', 'tv',
            '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
            '-movflags', '+faststart', "$($scene.name).mp4"
        ) "Encode $($scene.name)"
        $clipInfo = Get-MediaInfo "$($scene.name).mp4"
        $videoStream = @($clipInfo.streams | Where-Object codec_type -eq 'video')[0]
        $audioStream = @($clipInfo.streams | Where-Object codec_type -eq 'audio')[0]
        if ($videoStream.codec_name -ne 'h264' -or $videoStream.pix_fmt -ne 'yuv420p' -or $videoStream.width -ne 1440 -or $videoStream.height -ne 1120 -or $audioStream.codec_name -ne 'aac') {
            throw "Encoded stream validation failed for $($scene.name)."
        }
        Write-Output "Encoded $($scene.name): H.264 1440x1120 / AAC."
    }
    Write-Utf8 (Join-Path $runDirectory 'concat.txt') (($prepared | ForEach-Object { "file '$($_.name).mp4'" }) -join "`n")
    New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
    $null = Invoke-MediaCommand $ffmpeg @(
        '-hide_banner', '-loglevel', 'warning', '-nostdin', '-n', '-f', 'concat', '-safe', '1', '-i', 'concat.txt',
        '-c', 'copy', '-movflags', '+faststart', $OutputPath
    ) 'Concatenate scenes'
} finally {
    Pop-Location
}

$finalInfo = Get-MediaInfo $OutputPath
$finalSeconds = [double]::Parse($finalInfo.format.duration, $invariant)
if ([Math]::Abs($finalSeconds - $expectedSeconds) -gt 0.5 -or (-not $TechnicalTest -and ($finalSeconds -lt 60 -or $finalSeconds -gt 180))) {
    throw ('Final duration validation failed: actual {0:F3}s, expected {1:F3}s.' -f $finalSeconds, $expectedSeconds)
}
$report = [ordered]@{
    output = $OutputPath; technicalTest = [bool]$TechnicalTest; title = '本机交互截帧演示';
    narration = 'Microsoft Huihui Desktop / local SAPI synthetic speech, not a human recording';
    width = 1440; height = 1120; screenshotArea = '1440x1000'; footerHeight = 120;
    seconds = $finalSeconds; expectedSeconds = $expectedSeconds; scenes = $prepared.ToArray(); streams = $finalInfo.streams
}
Write-Utf8 (Join-Path $runDirectory 'verification.json') ($report | ConvertTo-Json -Depth 8)
Write-Output ('PASS: {0:F2}s video, {1} scene(s). Output: {2}' -f $finalSeconds, $prepared.Count, $OutputPath)
