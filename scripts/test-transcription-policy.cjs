const assert = require("node:assert/strict");
const {
  advanceTranscriptionProgress,
  fasterWhisperSupportsLanguage,
  formatFasterWhisperProgressMessage,
  formatProgressStatusDetail,
  formatRuntimeProgressDetail,
  formatTranscriptionSelectionDetail
} = require("../dist/main/transcription-policy.js");

const basePreferences = {
  theme: "system",
  closeBehavior: "tray",
  defaultLanguage: "auto",
  exportDirectory: "",
  ffmpegExecutablePath: "",
  disableGpu: false,
  transcriptionEngine: "faster-whisper",
  whisperCppModel: "ggml-small",
  fasterWhisperModel: "large-v3-turbo",
  whisperThreads: 0
};

assert.equal(fasterWhisperSupportsLanguage("distil-large-v3", "en"), true);
assert.equal(fasterWhisperSupportsLanguage("distil-large-v3", "auto"), false);
assert.equal(fasterWhisperSupportsLanguage("distil-large-v3", "zh"), false);
assert.equal(fasterWhisperSupportsLanguage("large-v3-turbo", "auto"), true);
assert.equal(fasterWhisperSupportsLanguage("large-v3-turbo", "zh"), true);

assert.equal(
  formatTranscriptionSelectionDetail(basePreferences, "auto"),
  "当前使用：Faster-Whisper · Large V3 Turbo"
);
assert.equal(
  formatTranscriptionSelectionDetail({
    ...basePreferences,
    fasterWhisperModel: "distil-large-v3",
    whisperCppModel: "ggml-large-v3-q5_0"
  }, "auto"),
  "当前使用：Whisper.cpp · Large V3 Q5_0（Distil Large V3 仅支持英语，已自动切换）"
);
assert.equal(
  formatTranscriptionSelectionDetail({
    ...basePreferences,
    transcriptionEngine: "whisper-cpp"
  }, "auto"),
  "当前使用：Whisper.cpp · Whisper Small"
);

assert.equal(advanceTranscriptionProgress(70, 56), 70);
assert.equal(advanceTranscriptionProgress(70, 82), 82);
assert.equal(advanceTranscriptionProgress(70, undefined), 70);
assert.equal(advanceTranscriptionProgress(70, 120), 100);

assert.equal(
  formatFasterWhisperProgressMessage("正在使用 Faster-Whisper 识别语音内容（1/2）", "cuda"),
  "正在使用 NVIDIA CUDA 识别语音内容（1/2）"
);
assert.equal(
  formatFasterWhisperProgressMessage("正在使用 Faster-Whisper 识别语音内容（1/2）", "cpu"),
  "正在使用 CPU 识别语音内容（1/2）"
);
assert.equal(
  formatFasterWhisperProgressMessage("正在使用 Faster-Whisper 识别语音内容（1/2）"),
  "正在使用 Faster-Whisper 识别语音内容（1/2）"
);

const fixedTime = new Date(2026, 7, 21, 14, 32, 10);
assert.equal(
  formatRuntimeProgressDetail("size= 100kB time=00:01:23.45 bitrate=12.0kbits/s speed=25.5x", "normalizing", fixedTime),
  "[14:32:10] 音频转换进度 00:01:23.45，处理速度 25.5 倍"
);
assert.equal(
  formatRuntimeProgressDetail("[00:00:10.000 --> 00:00:12.000] 你好，世界", "transcribing", fixedTime),
  "[14:32:10] 识别片段 00:00:10.000–00:00:12.000：你好，世界"
);
assert.equal(
  formatProgressStatusDetail("正在识别语音内容（1/3）", 42.4, 65000, fixedTime),
  "[14:32:10] 正在识别语音内容（1/3），当前进度 42%，本阶段用时 01:05"
);

console.log("Transcription policy regression checks passed.");
