$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = Join-Path $projectRoot "resources\python"
$binaryRoot = Join-Path $projectRoot "resources\bin\Release"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("deskscribe-runtime-" + [guid]::NewGuid().ToString("N"))

function Reset-WorkspaceDirectory([string]$targetPath) {
  $resolvedParent = (Resolve-Path (Split-Path $targetPath -Parent)).Path
  if (-not $resolvedParent.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to reset a directory outside the project: $targetPath"
  }
  if (Test-Path -LiteralPath $targetPath) {
    Remove-Item -LiteralPath $targetPath -Recurse -Force
  }
  New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
}

try {
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  Reset-WorkspaceDirectory $runtimeRoot
  Reset-WorkspaceDirectory $binaryRoot

  $pythonArchive = Join-Path $temporaryRoot "python-embed.zip"
  Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip" -OutFile $pythonArchive
  Expand-Archive -LiteralPath $pythonArchive -DestinationPath $runtimeRoot -Force

  $sitePackages = Join-Path $runtimeRoot "runtime-packages\Lib\site-packages"
  New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null
  python -m pip install `
    --disable-pip-version-check `
    --no-cache-dir `
    --only-binary=:all: `
    --target $sitePackages `
    "faster-whisper==1.2.1" `
    "ctranslate2==4.7.1" `
    "av==17.0.1" `
    "huggingface-hub==1.12.2" `
    "tokenizers==0.22.2" `
    "onnxruntime==1.25.1" `
    "numpy==2.4.4" `
    "tqdm==4.67.3"

  $pythonPathFile = Join-Path $runtimeRoot "python311._pth"
  @(
    "python311.zip"
    "."
    "runtime-packages\Lib\site-packages"
    "import site"
  ) | Set-Content -LiteralPath $pythonPathFile -Encoding ascii

  $whisperArchive = Join-Path $temporaryRoot "whisper-bin-x64.zip"
  $whisperExtracted = Join-Path $temporaryRoot "whisper"
  Invoke-WebRequest -Uri "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip" -OutFile $whisperArchive
  Expand-Archive -LiteralPath $whisperArchive -DestinationPath $whisperExtracted -Force
  $whisperCli = Get-ChildItem -LiteralPath $whisperExtracted -Recurse -File -Filter "whisper-cli.exe" | Select-Object -First 1
  if (-not $whisperCli) {
    throw "whisper-cli.exe was not found in the pinned whisper.cpp release."
  }
  Copy-Item -Path (Join-Path $whisperCli.Directory.FullName "*") -Destination $binaryRoot -Recurse -Force

  $requiredFiles = @(
    (Join-Path $runtimeRoot "python.exe"),
    (Join-Path $sitePackages "faster_whisper\__init__.py"),
    (Join-Path $sitePackages "ctranslate2\__init__.py"),
    (Join-Path $binaryRoot "whisper-cli.exe")
  )
  foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile)) {
      throw "Prepared runtime is incomplete: $requiredFile"
    }
  }
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
