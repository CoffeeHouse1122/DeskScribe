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
