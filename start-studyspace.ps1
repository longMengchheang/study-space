param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$workspaceRoot = $PSScriptRoot
$studioRoot = Join-Path $workspaceRoot "studio"
$transcriptWhisperRoot = Join-Path $workspaceRoot "labs\\transcript-whisper"
$transcriptWhisperVenvPython = Join-Path $transcriptWhisperRoot ".venv\\Scripts\\python.exe"
$localRagRoot = Join-Path $workspaceRoot "labs\\local-rag-ai-assistant"
$localRagVenvPython = Join-Path $localRagRoot ".venv\\Scripts\\python.exe"
$studioEnvLocal = Join-Path $studioRoot ".env.local"
$transcriptWhisperApiBaseUrl = "http://127.0.0.1:8000/api/v1"
$localRagApiBaseUrl = "http://127.0.0.1:9999"
$codeAssistantBaseUrl = "http://127.0.0.1:11434"
$codeAssistantModel = "qwen2.5-coder:3b"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
}

function Ensure-EnvLine {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    $line = "$Key=$Value"

    if (-not (Test-Path $Path)) {
        Set-Content -Path $Path -Value "$line`r`n" -Encoding UTF8
        return
    }

    $content = Get-Content -Path $Path -Raw
    if ($content -match "(?m)^$([regex]::Escape($Key))=") {
        $updated = [regex]::Replace(
            $content,
            "(?m)^$([regex]::Escape($Key))=.*$",
            $line
        )
        Set-Content -Path $Path -Value $updated -Encoding UTF8
        return
    }

    $trimmed = $content.TrimEnd("`r", "`n")
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        Set-Content -Path $Path -Value "$line`r`n" -Encoding UTF8
    } else {
        Set-Content -Path $Path -Value ($trimmed + "`r`n" + $line + "`r`n") -Encoding UTF8
    }
}

function Install-TranscriptWhisper {
    Push-Location $transcriptWhisperRoot
    try {
        & $transcriptWhisperVenvPython -m pip install -e ".[dev]"
        if ($LASTEXITCODE -ne 0) {
            throw "Transcript Whisper dependency install failed."
        }
    } finally {
        Pop-Location
    }
}

function Install-LocalRag {
    Push-Location $localRagRoot
    try {
        & $localRagVenvPython -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) {
            throw "Local RAG dependency install failed."
        }
    } finally {
        Pop-Location
    }
}

function Test-TranscriptWhisperImport {
    if (-not (Test-Path $transcriptWhisperVenvPython)) {
        return $false
    }

    $cmd = '"' + $transcriptWhisperVenvPython + '" -W ignore -c "import transcript_whisper" >nul 2>nul'
    cmd.exe /d /c $cmd *> $null
    return $LASTEXITCODE -eq 0
}

function Test-LocalRagImport {
    if (-not (Test-Path $localRagVenvPython)) {
        return $false
    }

    Push-Location $localRagRoot
    try {
        $cmd = '"' + $localRagVenvPython + '" -W ignore -c "import api" >nul 2>nul'
        cmd.exe /d /c $cmd *> $null
        return $LASTEXITCODE -eq 0
    } finally {
        Pop-Location
    }
}

function Start-ServiceWindow {
    param(
        [string]$Title,
        [string]$WorkingDirectory,
        [string]$Command
    )

    if ($DryRun) {
        Write-Host "[dry-run] $Title :: cd `"$WorkingDirectory`" ; $Command"
        return
    }

    $encodedCommand = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Command))
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-EncodedCommand",
        $encodedCommand
    ) -WorkingDirectory $WorkingDirectory | Out-Null
}

function Resolve-FfmpegBinary {
    if ($env:FFMPEG_BINARY -and (Test-Path $env:FFMPEG_BINARY)) {
        return $env:FFMPEG_BINARY
    }

    $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        return $command.Source
    }

    $wingetPackagesRoot = Join-Path $env:LOCALAPPDATA "Microsoft\\WinGet\\Packages"
    if (Test-Path $wingetPackagesRoot) {
        $candidate = Get-ChildItem -Path $wingetPackagesRoot -Filter "Gyan.FFmpeg_*" -Directory |
            ForEach-Object {
                Get-ChildItem -Path $_.FullName -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue
            } |
            Select-Object -First 1 -ExpandProperty FullName

        if ($candidate) {
            return $candidate
        }
    }

    return $null
}

Write-Step "Preparing Studio environment"
Ensure-EnvLine -Path $studioEnvLocal -Key "TRANSCRIPT_WHISPER_API_BASE_URL" -Value $transcriptWhisperApiBaseUrl
Ensure-EnvLine -Path $studioEnvLocal -Key "LOCAL_RAG_API_BASE_URL" -Value $localRagApiBaseUrl
Ensure-EnvLine -Path $studioEnvLocal -Key "LOCAL_CODE_ASSISTANT_BASE_URL" -Value $codeAssistantBaseUrl
Ensure-EnvLine -Path $studioEnvLocal -Key "LOCAL_CODE_ASSISTANT_MODEL" -Value $codeAssistantModel

if (-not (Test-Path $transcriptWhisperVenvPython)) {
    Write-Step "Creating transcript-whisper virtual environment"
    if (-not $DryRun) {
        Push-Location $transcriptWhisperRoot
        try {
            python -m venv .venv
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "[dry-run] python -m venv .venv"
    }
}

if ((-not $DryRun) -and (-not (Test-Path $transcriptWhisperVenvPython))) {
    throw "Transcript Whisper virtual environment was not created successfully."
}

if (-not (Test-Path $localRagVenvPython)) {
    Write-Step "Creating local-rag-ai-assistant virtual environment"
    if (-not $DryRun) {
        Push-Location $localRagRoot
        try {
            python -m venv .venv
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "[dry-run] python -m venv .venv"
    }
}

if ((-not $DryRun) -and (-not (Test-Path $localRagVenvPython))) {
    throw "Local RAG virtual environment was not created successfully."
}

Write-Step "Ensuring transcript-whisper dependencies are installed"
if (-not $DryRun) {
    Install-TranscriptWhisper
} else {
    Write-Host "[dry-run] .venv\\Scripts\\python.exe -m pip install -e `".[dev]`""
}

Write-Step "Ensuring local-rag-ai-assistant dependencies are installed"
if (-not $DryRun) {
    Install-LocalRag
} else {
    Write-Host "[dry-run] .venv\\Scripts\\python.exe -m pip install -r requirements.txt"
}

if ((-not $DryRun) -and (-not (Test-TranscriptWhisperImport))) {
    Write-Step "Rebuilding transcript-whisper virtual environment after path change"
    if (Test-Path (Join-Path $transcriptWhisperRoot ".venv")) {
        Remove-Item -LiteralPath (Join-Path $transcriptWhisperRoot ".venv") -Recurse -Force
    }

    Push-Location $transcriptWhisperRoot
    try {
        python -m venv .venv
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $transcriptWhisperVenvPython)) {
        throw "Transcript Whisper virtual environment was not rebuilt successfully."
    }

    Install-TranscriptWhisper

    if (-not (Test-TranscriptWhisperImport)) {
        throw "Transcript Whisper import validation failed after virtual environment rebuild."
    }
}

if ((-not $DryRun) -and (-not (Test-LocalRagImport))) {
    Write-Step "Rebuilding local-rag-ai-assistant virtual environment after path change"
    if (Test-Path (Join-Path $localRagRoot ".venv")) {
        Remove-Item -LiteralPath (Join-Path $localRagRoot ".venv") -Recurse -Force
    }

    Push-Location $localRagRoot
    try {
        python -m venv .venv
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $localRagVenvPython)) {
        throw "Local RAG virtual environment was not rebuilt successfully."
    }

    Install-LocalRag

    if (-not (Test-LocalRagImport)) {
        throw "Local RAG import validation failed after virtual environment rebuild."
    }
}

$ffmpegBinary = Resolve-FfmpegBinary
$transcriptWhisperCommandPrefix = ""
if ($ffmpegBinary) {
    Write-Step "Using ffmpeg binary at $ffmpegBinary"
    $transcriptWhisperCommandPrefix = "`$env:FFMPEG_BINARY=`"$ffmpegBinary`"; "
} else {
    Write-Step "ffmpeg binary was not resolved by the launcher; relying on backend auto-detection"
}

$transcriptWhisperCommand = $transcriptWhisperCommandPrefix + "& `"$transcriptWhisperVenvPython`" -m uvicorn transcript_whisper.main:app --host 127.0.0.1 --port 8000 --reload"
$localRagCommand = "& `"$localRagVenvPython`" -m uvicorn api:app --host 127.0.0.1 --port 9999 --reload"
$studioCommand = "npm run dev"

Write-Step "Launching Transcript Whisper"
Start-ServiceWindow -Title "Transcript Whisper" -WorkingDirectory $transcriptWhisperRoot -Command $transcriptWhisperCommand

Write-Step "Launching Local RAG"
Start-ServiceWindow -Title "Local RAG" -WorkingDirectory $localRagRoot -Command $localRagCommand

Write-Step "Launching Studyspace Studio"
Start-ServiceWindow -Title "Studyspace Studio" -WorkingDirectory $studioRoot -Command $studioCommand

Write-Step "Studyspace startup complete"
Write-Host "Studio: http://localhost:3000/dashboard"
Write-Host "Transcript Whisper API: $transcriptWhisperApiBaseUrl"
Write-Host "Local RAG API: $localRagApiBaseUrl"
