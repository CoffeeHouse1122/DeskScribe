import { app } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureDir,
  fileNameFromMime,
  sanitizeBaseName,
  uniqueId
} from "./file-utils";
import type {
  AppPreferences,
  ExportFormat,
  RecordingAudioExportRequest,
  RecordingTranscriptionRequest,
  TranscriptDocument,
  TranscriptLanguage,
  TranscriptionProgressEvent,
  TranscriptSegment,
  TranscriptionResult
} from "../shared/types";

type ProgressReporter = (event: TranscriptionProgressEvent) => void;
type CommandProgressWindow = {
  base: number;
  span: number;
  message: string;
};

const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const WHISPER_SAFE_CHUNK_SECONDS = 60;
const WHISPER_BALANCED_CHUNK_SECONDS = 180;
const WHISPER_QUANTIZED_CHUNK_SECONDS = 600;
const WHISPER_GPU_CHUNK_SECONDS = 900;

export class TranscriptionCancelledError extends Error {
  constructor() {
    super("Transcription cancelled by user");
    this.name = "TranscriptionCancelledError";
  }
}

export class TranscriptionController {
  cancelled = false;
  private child: ChildProcess | null = null;

  attach(child: ChildProcess) {
    this.child = child;
    if (this.cancelled) {
      child.kill();
    }
  }

  detach(child: ChildProcess) {
    if (this.child === child) {
      this.child = null;
    }
  }

  cancel() {
    this.cancelled = true;
    this.child?.kill();
  }
}

export function isTranscriptionCancelled(error: unknown) {
  return error instanceof TranscriptionCancelledError;
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.filter(Boolean).map((item) => path.normalize(item))));
}

function resourceRoots() {
  return uniquePaths([
    path.join(process.resourcesPath, "resources"),
    process.resourcesPath,
    path.join(app.getAppPath(), "resources"),
    path.join(process.cwd(), "resources"),
    path.resolve(__dirname, "..", "..", "resources")
  ]);
}

function resourcePathCandidates(...parts: string[]) {
  return resourceRoots().map((root) => path.join(root, ...parts));
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function modelRank(fileName: string) {
  const normalized = fileName.toLowerCase();
  if (normalized.includes("tiny")) return 0;
  if (normalized.includes("base")) return 10;
  if (normalized.includes("small")) return 20;
  if (normalized.includes("medium")) return 30;
  if (normalized.includes("large")) return 40;
  return 2;
}

function modelStabilityRank(fileName: string, size: number) {
  const normalized = fileName.toLowerCase();
  const quality = modelRank(fileName) * 100;
  const quantizedBonus =
    /q8[_-]?0/i.test(normalized) ? 18 :
    /q5[_-]?[01]/i.test(normalized) ? 16 :
    /q4[_-]?[01]/i.test(normalized) ? 8 :
    0;
  const memoryPenalty = size > 2_500_000_000 ? 14 : size > 1_500_000_000 ? 6 : 0;
  return quality + quantizedBonus - memoryPenalty;
}

async function bundledModelCandidates() {
  const models: Array<{ filePath: string; fileName: string; size: number }> = [];
  for (const modelDir of resourcePathCandidates("models")) {
    try {
      const entries = await fs.readdir(modelDir, { withFileTypes: true });
      const matches = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => /\.(bin|gguf)$/i.test(name));
      for (const fileName of matches) {
        const filePath = path.join(modelDir, fileName);
        const stat = await fs.stat(filePath).catch(() => null);
        models.push({ filePath, fileName, size: stat?.size || 0 });
      }
    } catch {
      // Try the next possible resources directory.
    }
  }
  return models.sort((left, right) =>
    modelStabilityRank(right.fileName, right.size) - modelStabilityRank(left.fileName, left.size) ||
    right.size - left.size
  );
}

async function findBundledModel() {
  const models = await bundledModelCandidates();
  if (models[0]) {
    return models[0].filePath;
  }
  return "";
}

async function resolveModelPath(preferences: AppPreferences, logs: string[]) {
  const preferredModelPath = preferences.modelPath?.trim();
  if (preferredModelPath) {
    if (await exists(preferredModelPath)) {
      pushLog(logs, `Using preferred Whisper model: ${preferredModelPath}`);
      return preferredModelPath;
    }
    pushLog(logs, `Preferred Whisper model missing, falling back to bundled model: ${preferredModelPath}`);
  }

  const builtInModelPath = await findBundledModel();
  if (builtInModelPath) {
    pushLog(logs, `Using bundled Whisper model: ${builtInModelPath}`);
  }
  return builtInModelPath;
}

async function warnIfHighMemoryModel(modelPath: string, logs: string[]) {
  const stat = await fs.stat(modelPath).catch(() => null);
  if (stat && stat.size > 2_500_000_000) {
    pushLog(
      logs,
      "The selected Whisper model is larger than 2.5GB. For long imports, a quantized large-v3 model such as Q8_0 or Q5_0 usually keeps accuracy high while reducing crash risk."
    );
  }
}

async function chooseWhisperChunkSeconds(modelPath: string, preferences: AppPreferences, logs: string[]) {
  if (!preferences.disableGpu) {
    pushLog(logs, `GPU mode uses ${WHISPER_GPU_CHUNK_SECONDS}s chunks to reduce model reload overhead.`);
    return WHISPER_GPU_CHUNK_SECONDS;
  }

  const stat = await fs.stat(modelPath).catch(() => null);
  if (stat && stat.size <= 1_500_000_000) {
    pushLog(logs, `Quantized or compact model detected; using ${WHISPER_QUANTIZED_CHUNK_SECONDS}s chunks.`);
    return WHISPER_QUANTIZED_CHUNK_SECONDS;
  }

  pushLog(logs, `High-memory model detected; using safer ${WHISPER_SAFE_CHUNK_SECONDS}s chunks.`);
  return WHISPER_SAFE_CHUNK_SECONDS;
}

function fallbackChunkSeconds(currentSeconds: number) {
  if (currentSeconds > WHISPER_QUANTIZED_CHUNK_SECONDS) return WHISPER_QUANTIZED_CHUNK_SECONDS;
  if (currentSeconds > WHISPER_BALANCED_CHUNK_SECONDS) return WHISPER_BALANCED_CHUNK_SECONDS;
  if (currentSeconds > WHISPER_SAFE_CHUNK_SECONDS) return WHISPER_SAFE_CHUNK_SECONDS;
  return 0;
}

function executableName(baseName: string) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function executablePathCandidates(preferredPath: string | undefined, bundledPaths: string[]) {
  const preferred = preferredPath?.trim();
  return uniquePaths(preferred ? [preferred, ...bundledPaths] : bundledPaths);
}

function whisperCandidates(preferences: AppPreferences) {
  return uniquePaths([
    ...executablePathCandidates(preferences.whisperExecutablePath, []),
    ...resourcePathCandidates("bin", "Release", executableName("whisper-cli")),
    ...resourcePathCandidates("bin", executableName("whisper-cli"))
  ]);
}

function ffmpegCandidates(preferences?: AppPreferences) {
  return uniquePaths([
    ...executablePathCandidates(preferences?.ffmpegExecutablePath, []),
    ...resourcePathCandidates("bin", "Release", executableName("ffmpeg")),
    ...resourcePathCandidates("bin", executableName("ffmpeg"))
  ]);
}

function pushLog(logs: string[], line: string) {
  logs.push(line);
  if (logs.length > 160) {
    logs.splice(0, logs.length - 160);
  }
}

function parseCliPercent(line: string) {
  const match = line.match(/(?:progress\s*=\s*|^|\s)(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, value));
}

async function runCandidate(
  executable: string,
  args: string[],
  logs: string[],
  stage: TranscriptionProgressEvent["stage"],
  timeoutMs: number,
  report?: ProgressReporter,
  controller?: TranscriptionController,
  progressWindow?: CommandProgressWindow
) {
  return new Promise<void>((resolve, reject) => {
    if (controller?.cancelled) {
      reject(new TranscriptionCancelledError());
      return;
    }
    const startedAt = Date.now();
    let settled = false;
    let lastOutputAt = 0;
    const child = spawn(executable, args, {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    controller?.attach(child);

    const executableName = path.basename(executable);
    report?.({
      stage,
      message: `正在执行 ${executableName}`,
      progress: stage === "normalizing" ? 18 : 58,
      elapsedMs: 0
    });

    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeatTimer);
      child.kill();
      reject(new Error(`${executableName} timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);

    const heartbeatTimer = setInterval(() => {
      if (settled) return;
      const elapsedMs = Date.now() - startedAt;
      report?.({
        stage,
        message: progressWindow?.message || (stage === "normalizing" ? "正在转换音频格式" : "正在识别语音内容"),
        progress: stage === "normalizing" ? 32 : progressWindow ? Math.round(progressWindow.base) : undefined,
        elapsedMs
      });
    }, 5000);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearInterval(heartbeatTimer);
      controller?.detach(child);
      callback();
    };

    const collectOutput = (chunk: Buffer) => {
      const line = String(chunk).trim();
      if (!line) return;
      pushLog(logs, line);
      const now = Date.now();
      const cliPercent = stage === "transcribing" ? parseCliPercent(line) : undefined;
      if (now - lastOutputAt > 900) {
        lastOutputAt = now;
        report?.({
          stage,
          message: progressWindow?.message || (stage === "normalizing" ? "正在转换音频格式" : "正在识别语音内容"),
          detail: line.slice(0, 240),
          progress: cliPercent !== undefined && progressWindow
            ? Math.round(progressWindow.base + (cliPercent / 100) * progressWindow.span)
            : stage === "normalizing" ? 42 : undefined,
          elapsedMs: now - startedAt
        });
      }
    };

    child.stdout.on("data", (chunk) => {
      collectOutput(chunk);
    });
    child.stderr.on("data", (chunk) => {
      collectOutput(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(controller?.cancelled ? new TranscriptionCancelledError() : error));
    });
    child.on("close", (code) => {
      finish(() => {
        if (controller?.cancelled) {
          reject(new TranscriptionCancelledError());
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(`${executableName} exited with code ${code}`));
      });
    });
  });
}

async function runWithCandidates(
  candidates: string[],
  args: string[],
  logs: string[],
  missingMessage: string,
  stage: TranscriptionProgressEvent["stage"],
  timeoutMs: number,
  report?: ProgressReporter,
  controller?: TranscriptionController,
  progressWindow?: CommandProgressWindow
) {
  let lastError: unknown = new Error(missingMessage);
  for (const candidate of candidates) {
    if (controller?.cancelled) {
      throw new TranscriptionCancelledError();
    }
    try {
      if (!(await exists(candidate))) {
        pushLog(logs, `Candidate missing: ${candidate}`);
        continue;
      }
      await runCandidate(candidate, args, logs, stage, timeoutMs, report, controller, progressWindow);
      return candidate;
    } catch (error) {
      if (isTranscriptionCancelled(error)) {
        throw error;
      }
      lastError = error;
      pushLog(logs, `Candidate failed: ${candidate} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const checkedPaths = candidates.length > 0 ? ` Checked: ${candidates.join(" | ")}` : "";
  throw new Error(`${lastError instanceof Error ? lastError.message : String(lastError)}${checkedPaths}`);
}

async function writeRecordingInput(input: RecordingTranscriptionRequest | RecordingAudioExportRequest) {
  const jobId = uniqueId("recording");
  const tempDir = path.join(app.getPath("temp"), "deskscribe", jobId);
  await ensureDir(tempDir);
  const extension = fileNameFromMime(input.mimeType);
  const safeName = sanitizeBaseName(input.fileName || "recording");
  const sourcePath = path.join(tempDir, `${safeName}.${extension}`);
  await fs.writeFile(sourcePath, Buffer.from(input.bytes));
  return { sourcePath, tempDir, safeName };
}

async function normalizeAudio(inputPath: string, tempDir: string, preferences: AppPreferences, logs: string[], report?: ProgressReporter, controller?: TranscriptionController) {
  const outputPath = path.join(tempDir, "normalized.wav");
  report?.({ stage: "normalizing", message: "正在读取并转换音频", progress: 12 });
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-vn",
    "-i",
    inputPath,
    "-af",
    "highpass=f=80,lowpass=f=7800,dynaudnorm=f=150:g=15",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    outputPath
  ];
  await runWithCandidates(
    ffmpegCandidates(preferences),
    args,
    logs,
    "Unable to locate bundled FFmpeg. Rebuild or reinstall DeskScribe so resources/bin/Release contains ffmpeg.",
    "normalizing",
    FFMPEG_TIMEOUT_MS,
    report,
    controller
  );
  report?.({ stage: "normalizing", message: "音频已转换为 16kHz 单声道 WAV", progress: 50 });
  return outputPath;
}

async function splitAudioFile(
  inputPath: string,
  chunksDir: string,
  outputPrefix: string,
  preferences: AppPreferences,
  chunkSeconds: number,
  logs: string[],
  report?: ProgressReporter,
  controller?: TranscriptionController
) {
  if (controller?.cancelled) {
    throw new TranscriptionCancelledError();
  }
  await ensureDir(chunksDir);
  const outputPattern = path.join(chunksDir, `${outputPrefix}-%04d.wav`);
  await runWithCandidates(
    ffmpegCandidates(preferences),
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkSeconds),
      "-reset_timestamps",
      "1",
      "-c",
      "copy",
      outputPattern
    ],
    logs,
    "Unable to locate bundled FFmpeg. Rebuild or reinstall DeskScribe so resources/bin/Release contains ffmpeg.",
    "normalizing",
    FFMPEG_TIMEOUT_MS,
    report,
    controller
  );
  const chunkPaths = (await fs.readdir(chunksDir))
    .filter((name) => new RegExp(`^${outputPrefix}-\\d+\\.wav$`, "i").test(name))
    .sort()
    .map((name) => path.join(chunksDir, name));
  if (chunkPaths.length === 0) {
    pushLog(logs, `No split chunks were created for ${path.basename(inputPath)}; falling back to the original audio file.`);
    return [inputPath];
  }
  pushLog(logs, `Audio split into ${chunkPaths.length} chunk(s) of up to ${chunkSeconds} seconds.`);
  return chunkPaths;
}

async function splitNormalizedAudio(
  normalizedPath: string,
  tempDir: string,
  preferences: AppPreferences,
  chunkSeconds: number,
  logs: string[],
  report?: ProgressReporter,
  controller?: TranscriptionController
) {
  report?.({ stage: "normalizing", message: "正在拆分音频以降低转写内存占用", progress: 52 });
  return splitAudioFile(
    normalizedPath,
    path.join(tempDir, "chunks"),
    "chunk",
    preferences,
    chunkSeconds,
    logs,
    report,
    controller
  );
}

export async function exportRecordingAudio(input: RecordingAudioExportRequest, outputPath: string) {
  const logs: string[] = [];
  const { sourcePath, tempDir } = await writeRecordingInput(input);
  await ensureDir(path.dirname(outputPath));
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    sourcePath,
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "192k",
    outputPath
  ];
  await runWithCandidates(
    ffmpegCandidates(),
    args,
    logs,
    "Unable to locate bundled FFmpeg. Rebuild or reinstall DeskScribe so resources/bin/Release contains ffmpeg.",
    "normalizing",
    FFMPEG_TIMEOUT_MS
  );
  await fs.rm(tempDir, { recursive: true, force: true });
  return { outputPath, logs };
}

function languagePrompt(language: TranscriptLanguage) {
  if (language === "zh") {
    return "以下是清晰的中文普通话语音转写文本。请保留自然标点，避免添加不存在的内容。";
  }
  if (language === "en") {
    return "This is a clear English speech transcription. Keep natural punctuation and do not add content that was not spoken.";
  }
  return "";
}

function normalizeSegmentText(text: string) {
  return text.replace(/\s+\n/g, "\n").trim();
}

function isKnownNonSpeechHallucination(text: string) {
  const normalized = text.toLowerCase().replace(/[\s.,，。:：!！?？'"“”‘’]/g, "");
  return normalized.includes("subtitlesbytheamaraorgcommunity") || normalized.includes("amaraorg");
}

function parseWhisperOutput(
  raw: string,
  sourceType: "recording" | "file",
  fileName: string,
  requestedLanguage: TranscriptLanguage,
  modelPath: string,
  offsetMs = 0
): TranscriptDocument {
  const parsed = JSON.parse(raw) as {
    result?: { language?: string };
    transcription?: Array<{
      text?: string;
      offsets?: { from?: number; to?: number };
    }>;
  };

  const segments: TranscriptSegment[] = (parsed.transcription || []).map((segment, index) => ({
    id: index + 1,
    startMs: offsetMs + Math.max(0, Number(segment.offsets?.from || 0)),
    endMs: offsetMs + Math.max(0, Number(segment.offsets?.to || 0)),
    text: normalizeSegmentText(segment.text || "")
  })).filter((segment) => segment.text.length > 0 && !isKnownNonSpeechHallucination(segment.text));

  return {
    version: 1,
    source: {
      type: sourceType,
      fileName,
      durationMs: segments.length > 0 ? segments[segments.length - 1].endMs : undefined,
      language: requestedLanguage
    },
    text: segments.map((segment) => segment.text).join("\n"),
    segments,
    createdAt: new Date().toISOString(),
    engine: {
      name: "whisper.cpp",
      model: modelPath,
      detectedLanguage: parsed.result?.language
    }
  };
}

function isLikelyEmptyAudioWhisperFailure(error: unknown, chunkLogs: string[]) {
  const message = error instanceof Error ? error.message : String(error);
  const joinedLogs = chunkLogs.join("\n");
  return /whisper-cli(?:\.exe)? exited with code 1/i.test(message) &&
    /processing|auto-detected language/i.test(joinedLogs) &&
    !/error|failed|invalid|unable|cannot|exception|abort/i.test(joinedLogs);
}

function isWhisperRuntimeCrash(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /whisper-cli(?:\.exe)? exited with code 3221226505/i.test(message);
}

function buildWhisperArgs(
  chunkPath: string,
  outputBase: string,
  modelPath: string,
  language: TranscriptLanguage,
  preferences: AppPreferences,
  compatibilityMode = false
) {
  const args = [
    "-m",
    modelPath,
    "-f",
    chunkPath,
    "-ojf",
    "-of",
    outputBase,
    "-l",
    language,
    "-t",
    "2",
    "-p",
    "1",
    "-bs",
    "1",
    "-bo",
    "1",
    "-mc",
    "0",
    "-nfa",
    "-pp"
  ];
  if (!compatibilityMode) {
    args.push("-sns");
  }
  if (preferences.disableGpu) {
    args.push("-ng");
  }
  const prompt = compatibilityMode ? "" : languagePrompt(language);
  if (prompt) {
    args.push("--prompt", prompt, "--carry-initial-prompt");
  }
  return args;
}

async function runWhisperChunk(
  chunkPath: string,
  outputBase: string,
  modelPath: string,
  language: TranscriptLanguage,
  preferences: AppPreferences,
  logs: string[],
  sourceType: "recording" | "file",
  fileName: string,
  offsetMs: number,
  progressWindow: CommandProgressWindow,
  report?: ProgressReporter,
  controller?: TranscriptionController
) {
  const outputPath = `${outputBase}.json`;
  const logStart = logs.length;
  let executable = "";
  const runArgs = async (args: string[]) => runWithCandidates(
    whisperCandidates(preferences),
    args,
    logs,
    "Unable to locate bundled whisper.cpp CLI. Rebuild or reinstall DeskScribe so resources/bin/Release contains whisper-cli.",
    "transcribing",
    WHISPER_TIMEOUT_MS,
    report,
    controller,
    progressWindow
  );
  try {
    executable = await runArgs(buildWhisperArgs(chunkPath, outputBase, modelPath, language, preferences));
  } catch (error) {
    if (isWhisperRuntimeCrash(error)) {
      pushLog(logs, `whisper-cli crashed on ${path.basename(chunkPath)}; retrying with compatibility parameters.`);
      executable = await runArgs(buildWhisperArgs(chunkPath, outputBase, modelPath, language, preferences, true));
    } else if (!isLikelyEmptyAudioWhisperFailure(error, logs.slice(logStart))) {
      throw error;
    } else {
      pushLog(logs, `No speech was detected in ${path.basename(chunkPath)}; treating it as an empty audio segment.`);
    }
  }
  let raw = "";
  try {
    raw = await fs.readFile(outputPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    pushLog(logs, `No transcript JSON was produced for ${path.basename(chunkPath)}; treating it as an empty audio segment.`);
    raw = JSON.stringify({ transcription: [] });
  }
  return {
    document: parseWhisperOutput(raw, sourceType, fileName, language, path.basename(modelPath), offsetMs),
    outputPath,
    executable
  };
}

async function runWhisperChunkWithFallback(
  chunkPath: string,
  outputBase: string,
  modelPath: string,
  language: TranscriptLanguage,
  preferences: AppPreferences,
  logs: string[],
  sourceType: "recording" | "file",
  fileName: string,
  offsetMs: number,
  chunkSeconds: number,
  progressWindow: CommandProgressWindow,
  report?: ProgressReporter,
  controller?: TranscriptionController
): Promise<{ documents: TranscriptDocument[]; executable: string }> {
  try {
    const result = await runWhisperChunk(
      chunkPath,
      outputBase,
      modelPath,
      language,
      preferences,
      logs,
      sourceType,
      fileName,
      offsetMs,
      progressWindow,
      report,
      controller
    );
    return { documents: [result.document], executable: result.executable };
  } catch (error) {
    const nextChunkSeconds = fallbackChunkSeconds(chunkSeconds);
    if (!isWhisperRuntimeCrash(error) || nextChunkSeconds <= 0) {
      throw error;
    }

    pushLog(
      logs,
      `Chunk ${path.basename(chunkPath)} crashed at ${chunkSeconds}s; splitting it into ${nextChunkSeconds}s fallback chunks.`
    );
    report?.({
      stage: "transcribing",
      message: `当前片段较大，正在拆成 ${nextChunkSeconds} 秒小片段重试`,
      progress: Math.round(progressWindow.base)
    });

    const fallbackDir = path.join(path.dirname(outputBase), `fallback-${uniqueId("chunk")}`);
    const fallbackChunks = await splitAudioFile(
      chunkPath,
      fallbackDir,
      "chunk",
      preferences,
      nextChunkSeconds,
      logs,
      report,
      controller
    );
    const documents: TranscriptDocument[] = [];
    let executable = "";

    for (const [index, fallbackChunk] of fallbackChunks.entries()) {
      const childBase = progressWindow.base + (index / Math.max(1, fallbackChunks.length)) * progressWindow.span;
      const childSpan = progressWindow.span / Math.max(1, fallbackChunks.length);
      const childMessage = `${progressWindow.message} · 重试 ${index + 1}/${fallbackChunks.length}`;
      const result = await runWhisperChunkWithFallback(
        fallbackChunk,
        `${outputBase}-fallback-${String(index).padStart(3, "0")}`,
        modelPath,
        language,
        preferences,
        logs,
        sourceType,
        fileName,
        offsetMs + index * nextChunkSeconds * 1000,
        nextChunkSeconds,
        {
          base: childBase,
          span: childSpan,
          message: childMessage
        },
        report,
        controller
      );
      documents.push(...result.documents);
      if (result.executable) {
        executable = result.executable;
      }
    }

    return { documents, executable };
  }
}

function mergeTranscriptDocuments(
  documents: TranscriptDocument[],
  sourceType: "recording" | "file",
  fileName: string,
  language: TranscriptLanguage,
  modelPath: string
): TranscriptDocument {
  const segments = documents
    .flatMap((document) => document.segments)
    .sort((left, right) => left.startMs - right.startMs)
    .map((segment, index) => ({ ...segment, id: index + 1 }));
  return {
    version: 1,
    source: {
      type: sourceType,
      fileName,
      durationMs: segments.length > 0 ? segments[segments.length - 1].endMs : undefined,
      language
    },
    text: segments.map((segment) => segment.text).join("\n"),
    segments,
    createdAt: new Date().toISOString(),
    engine: {
      name: "whisper.cpp",
      model: path.basename(modelPath),
      detectedLanguage: documents.find((document) => document.engine.detectedLanguage)?.engine.detectedLanguage
    }
  };
}

async function runWhisper(
  normalizedPath: string,
  tempDir: string,
  preferences: AppPreferences,
  language: TranscriptLanguage,
  logs: string[],
  sourceType: "recording" | "file",
  fileName: string,
  report?: ProgressReporter,
  controller?: TranscriptionController
) {
  report?.({ stage: "transcribing", message: "正在加载 Whisper 模型", progress: 54 });
  const modelPath = await resolveModelPath(preferences, logs);

  if (!modelPath) {
    throw new Error(
      "No bundled Whisper model was found. Rebuild or reinstall DeskScribe so resources/models contains a ggml or gguf model."
    );
  }

  pushLog(
    logs,
    preferences.disableGpu
      ? "Using whisper-cli in CPU stable mode."
      : "GPU mode requested; DeskScribe will not pass --no-gpu. Use a GPU-enabled whisper-cli build for hardware acceleration."
  );
  await warnIfHighMemoryModel(modelPath, logs);
  const chunkSeconds = await chooseWhisperChunkSeconds(modelPath, preferences, logs);
  const chunkMs = chunkSeconds * 1000;

  const chunks = await splitNormalizedAudio(normalizedPath, tempDir, preferences, chunkSeconds, logs, report, controller);
  const documents: TranscriptDocument[] = [];
  let executable = "";
  for (const [index, chunkPath] of chunks.entries()) {
    if (controller?.cancelled) {
      throw new TranscriptionCancelledError();
    }
    const chunkProgressBase = 56 + (index / Math.max(1, chunks.length)) * 32;
    const chunkProgressSpan = 32 / Math.max(1, chunks.length);
    const chunkMessage = `正在识别语音内容（${index + 1}/${chunks.length}）`;
    report?.({
      stage: "transcribing",
      message: chunkMessage,
      progress: Math.round(chunkProgressBase)
    });
    const result = await runWhisperChunkWithFallback(
      chunkPath,
      path.join(tempDir, `transcript-${String(index).padStart(4, "0")}`),
      modelPath,
      language,
      preferences,
      logs,
      sourceType,
      fileName,
      index * chunkMs,
      chunkSeconds,
      {
        base: chunkProgressBase,
        span: chunkProgressSpan,
        message: chunkMessage
      },
      report,
      controller
    );
    documents.push(...result.documents);
    if (result.executable) {
      executable = result.executable;
    }
  }

  report?.({ stage: "finalizing", message: "正在整理转写结果", progress: 92 });
  const outputPath = path.join(tempDir, "transcript-merged.json");
  const document = mergeTranscriptDocuments(documents, sourceType, fileName, language, modelPath);
  await fs.writeFile(outputPath, JSON.stringify(document, null, 2), "utf8");
  pushLog(logs, executable ? `Transcribed with ${path.basename(executable)}` : "Transcribed without detected speech.");
  return { document, outputPath };
}

export async function transcribeRecording(input: RecordingTranscriptionRequest, preferences: AppPreferences, report?: ProgressReporter, controller?: TranscriptionController): Promise<TranscriptionResult> {
  const logs: string[] = [];
  report?.({ stage: "queued", message: "正在准备录音数据", progress: 5 });
  const { sourcePath, tempDir, safeName } = await writeRecordingInput(input);
  const normalizedPath = await normalizeAudio(sourcePath, tempDir, preferences, logs, report, controller);
  const { document, outputPath } = await runWhisper(
    normalizedPath,
    tempDir,
    preferences,
    input.language,
    logs,
    "recording",
    `${safeName}.wav`,
    report,
    controller
  );
  report?.({ stage: "completed", message: "转写完成", progress: 100 });
  return { document, outputPath, normalizedPath, logs };
}

export async function transcribeFile(filePath: string, language: TranscriptLanguage, preferences: AppPreferences, report?: ProgressReporter, controller?: TranscriptionController): Promise<TranscriptionResult> {
  const logs: string[] = [];
  report?.({ stage: "queued", message: `正在准备导入文件：${path.basename(filePath)}`, progress: 5 });
  const tempDir = path.join(app.getPath("temp"), "deskscribe", uniqueId("file"));
  await ensureDir(tempDir);
  const normalizedPath = await normalizeAudio(filePath, tempDir, preferences, logs, report, controller);
  const { document, outputPath } = await runWhisper(
    normalizedPath,
    tempDir,
    preferences,
    language,
    logs,
    "file",
    path.basename(filePath),
    report,
    controller
  );
  report?.({ stage: "completed", message: "转写完成", progress: 100 });
  return { document, outputPath, normalizedPath, logs };
}

function formatSrtTime(timeMs: number) {
  const hours = Math.floor(timeMs / 3600000);
  const minutes = Math.floor((timeMs % 3600000) / 60000);
  const seconds = Math.floor((timeMs % 60000) / 1000);
  const milliseconds = Math.floor(timeMs % 1000);
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":") + `,${String(milliseconds).padStart(3, "0")}`;
}

function transcriptToSrt(document: TranscriptDocument) {
  return document.segments.map((segment) => [
    String(segment.id),
    `${formatSrtTime(segment.startMs)} --> ${formatSrtTime(segment.endMs)}`,
    segment.text
  ].join("\n")).join("\n\n");
}

export async function exportTranscript(document: TranscriptDocument, filePath: string, format: ExportFormat) {
  const content =
    format === "json"
      ? JSON.stringify(document, null, 2)
      : format === "srt"
        ? transcriptToSrt(document)
        : document.text;
  await fs.writeFile(filePath, content, "utf8");
}
