const fs = require("node:fs");
const path = require("node:path");

const ffmpegPath = require("ffmpeg-static");

if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
  throw new Error("ffmpeg-static binary was not found. Run npm install before building DeskScribe.");
}

const projectRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(projectRoot, "resources", "bin", "Release");
const targetName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const targetPath = path.join(releaseDir, targetName);
const whisperName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
const whisperPath = path.join(releaseDir, whisperName);
const pythonName = process.platform === "win32" ? "python.exe" : "python";
const pythonPath = path.join(
  projectRoot,
  "resources",
  "python",
  process.platform === "win32" ? "Scripts" : "bin",
  pythonName
);
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
  console.warn(`Bundled Faster-Whisper Python runtime was not found: ${pythonPath}`);
  console.warn("Faster-Whisper will fall back to system Python if available.");
} else {
  console.log(`Verified bundled Faster-Whisper Python runtime: ${pythonPath}`);
}

if (!fs.existsSync(fasterWhisperModelPath)) {
  throw new Error(`Bundled Faster-Whisper model was not found: ${fasterWhisperModelPath}`);
}

console.log(`Verified bundled Faster-Whisper model: ${fasterWhisperModelPath}`);
