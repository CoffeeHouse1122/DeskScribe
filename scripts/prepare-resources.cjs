const fs = require("node:fs");
const path = require("node:path");

const ffmpegPath = require("ffmpeg-static");

if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
  throw new Error("ffmpeg-static binary was not found. Run npm install before building DeskScribe.");
}

const projectRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(projectRoot, "resources", "bin", "Release");
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const targetName = isWindows ? "ffmpeg.exe" : "ffmpeg";
const targetPath = path.join(releaseDir, targetName);
const whisperName = isWindows ? "whisper-cli.exe" : "whisper-cli";
const whisperPath = path.join(releaseDir, whisperName);
const pythonName = isWindows ? "python.exe" : "python";
const pythonRoot = path.join(projectRoot, "resources", "python");
const portablePythonPath = path.join(pythonRoot, pythonName);
const environmentPythonPath = path.join(
  pythonRoot,
  isWindows ? "Scripts" : "bin",
  pythonName
);
const pythonPath = isWindows
  ? portablePythonPath
  : fs.existsSync(portablePythonPath)
    ? portablePythonPath
    : environmentPythonPath;
const fasterWhisperModelPath = path.join(
  projectRoot,
  "resources",
  "models",
  "faster-whisper",
  "distil-large-v3",
  "model.bin"
);
const whisperCppModelPath = path.join(
  projectRoot,
  "resources",
  "models",
  "ggml-small.bin"
);
const appIconPath = path.join(
  projectRoot,
  "resources",
  "icons",
  isMac ? "icon.icns" : isWindows ? "icon.ico" : "icon.png"
);

fs.mkdirSync(releaseDir, { recursive: true });
fs.copyFileSync(ffmpegPath, targetPath);

try {
  fs.chmodSync(targetPath, 0o755);
} catch {
  // Windows does not need chmod for the copied executable.
}

console.log(`Prepared bundled FFmpeg: ${targetPath}`);

if (!fs.existsSync(whisperPath)) {
  throw new Error(`Bundled whisper.cpp CLI was not found: ${whisperPath}`);
}

console.log(`Verified bundled whisper.cpp CLI: ${whisperPath}`);

if (!fs.existsSync(whisperCppModelPath)) {
  throw new Error(`Bundled whisper.cpp model was not found: ${whisperCppModelPath}`);
}

console.log(`Verified bundled whisper.cpp model: ${whisperCppModelPath}`);

if (!fs.existsSync(pythonPath)) {
  throw new Error(`Bundled Faster-Whisper Python runtime was not found: ${pythonPath}`);
}

if (isWindows) {
  const portableRuntimeFiles = [
    "python311.dll",
    "python311.zip",
    "python311._pth",
    path.join("runtime-packages", "Lib", "site-packages", "faster_whisper", "__init__.py"),
    path.join("runtime-packages", "Lib", "site-packages", "ctranslate2", "__init__.py")
  ];
  for (const relativePath of portableRuntimeFiles) {
    const requiredPath = path.join(pythonRoot, relativePath);
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Bundled portable Python runtime is incomplete: ${requiredPath}`);
    }
  }
}

console.log(`Verified bundled Faster-Whisper Python runtime: ${pythonPath}`);

if (!fs.existsSync(fasterWhisperModelPath)) {
  throw new Error(`Bundled Faster-Whisper model was not found: ${fasterWhisperModelPath}`);
}

console.log(`Verified bundled Faster-Whisper model: ${fasterWhisperModelPath}`);

if (!fs.existsSync(appIconPath)) {
  throw new Error(`Application icon was not found for ${process.platform}: ${appIconPath}`);
}

console.log(`Verified application icon: ${appIconPath}`);
