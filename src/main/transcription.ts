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

const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const WHISPER_CHUNK_SECONDS = 180;
const WHISPER_CHUNK_MS = WHISPER_CHUNK_SECONDS * 1000;

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
  if (normalized.includes("base")) return 1;
  if (normalized.includes("small")) return 2;
  if (normalized.includes("medium")) return 3;
  if (normalized.includes("large")) return 4;
  return 2;
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
  return models.sort((left, right) => modelRank(left.fileName) - modelRank(right.fileName) || left.size - right.size);
}

async function findBundledModel() {
  const models = await bundledModelCandidates();
  if (models[0]) {
    return models[0].filePath;
  }
  return "";
}

function executableName(baseName: string) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function whisperCandidates() {
  return uniquePaths([
    ...resourcePathCandidates("bin", "Release", executableName("whisper-cli")),
    ...resourcePathCandidates("bin", executableName("whisper-cli"))
  ]);
}

function ffmpegCandidates() {
  return uniquePaths([
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

async function runCandidate(
  executable: string,
  args: string[],
  logs: string[],
  stage: TranscriptionProgressEvent["stage"],
  timeoutMs: number,
  report?: ProgressReporter,
  controller?: TranscriptionController
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
        message: stage === "normalizing" ? "正在转换音频格式" : "正在识别语音内容",
        progress: stage === "normalizing" ? 32 : undefined,
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
      if (now - lastOutputAt > 900) {
        lastOutputAt = now;
        report?.({
          stage,
          message: stage === "normalizing" ? "正在转换音频格式" : "正在识别语音内容",
          detail: line.slice(0, 240),
          progress: stage === "normalizing" ? 42 : undefined,
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
  controller?: TranscriptionController
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
      await runCandidate(candidate, args, logs, stage, timeoutMs, report, controller);
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
    ffmpegCandidates(),
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

async function splitNormalizedAudio(normalizedPath: string, tempDir: string, logs: string[], report?: ProgressReporter, controller?: TranscriptionController) {
  if (controller?.cancelled) {
    throw new TranscriptionCancelledError();
  }
  const chunksDir = path.join(tempDir, "chunks");
  await ensureDir(chunksDir);
  const outputPattern = path.join(chunksDir, "chunk-%04d.wav");
  report?.({ stage: "normalizing", message: "正在拆分音频以降低转写内存占用", progress: 52 });
  await runWithCandidates(
    ffmpegCandidates(),
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      normalizedPath,
      "-f",
      "segment",
      "-segment_time",
      String(WHISPER_CHUNK_SECONDS),
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
    .filter((name) => /^chunk-\d+\.wav$/i.test(name))
    .sort()
    .map((name) => path.join(chunksDir, name));
  if (chunkPaths.length === 0) {
    pushLog(logs, "No split chunks were created; falling back to the normalized audio file.");
    return [normalizedPath];
  }
  pushLog(logs, `Audio split into ${chunkPaths.length} chunk(s) of up to ${WHISPER_CHUNK_SECONDS} seconds.`);
  return chunkPaths;
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

async function runWhisperChunk(
  chunkPath: string,
  outputBase: string,
  modelPath: string,
  language: TranscriptLanguage,
  logs: string[],
  sourceType: "recording" | "file",
  fileName: string,
  offsetMs: number,
  report?: ProgressReporter,
  controller?: TranscriptionController
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
    "-ng",
    "-nfa",
    "-pp",
    "-sns",
    "--suppress-regex",
    "(?i)subtitles by the amara\\.org community|amara\\.org"
  ];
  const prompt = languagePrompt(language);
  if (prompt) {
    args.push("--prompt", prompt, "--carry-initial-prompt");
  }

  const executable = await runWithCandidates(
    whisperCandidates(),
    args,
    logs,
    "Unable to locate bundled whisper.cpp CLI. Rebuild or reinstall DeskScribe so resources/bin/Release contains whisper-cli.",
    "transcribing",
    WHISPER_TIMEOUT_MS,
    report,
    controller
  );
  const outputPath = `${outputBase}.json`;
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
  const builtInModelPath = await findBundledModel();
  const modelPath = builtInModelPath || preferences.modelPath;

  if (!modelPath) {
    throw new Error(
      "No bundled Whisper model was found. Rebuild or reinstall DeskScribe so resources/models contains a ggml or gguf model."
    );
  }

  if (!preferences.disableGpu) {
    pushLog(logs, "GPU preference is ignored for stability; using bundled whisper-cli in CPU mode.");
  }

  const chunks = await splitNormalizedAudio(normalizedPath, tempDir, logs, report, controller);
  const documents: TranscriptDocument[] = [];
  let executable = "";
  for (const [index, chunkPath] of chunks.entries()) {
    if (controller?.cancelled) {
      throw new TranscriptionCancelledError();
    }
    report?.({
      stage: "transcribing",
      message: `正在识别语音内容（${index + 1}/${chunks.length}）`,
      progress: 56 + Math.round((index / Math.max(1, chunks.length)) * 32)
    });
    const result = await runWhisperChunk(
      chunkPath,
      path.join(tempDir, `transcript-${String(index).padStart(4, "0")}`),
      modelPath,
      language,
      logs,
      sourceType,
      fileName,
      index * WHISPER_CHUNK_MS,
      report,
      controller
    );
    documents.push(result.document);
    executable = result.executable;
  }

  report?.({ stage: "finalizing", message: "正在整理转写结果", progress: 92 });
  const outputPath = path.join(tempDir, "transcript-merged.json");
  const document = mergeTranscriptDocuments(documents, sourceType, fileName, language, modelPath);
  await fs.writeFile(outputPath, JSON.stringify(document, null, 2), "utf8");
  pushLog(logs, `Transcribed with ${path.basename(executable)}`);
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
