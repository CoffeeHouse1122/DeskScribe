import { app, net } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type {
  FasterWhisperModel,
  ManagedModelId,
  ManagedModelInfo,
  ModelDownloadProgress,
  TranscriptionEngine,
  WhisperCppModel
} from "../shared/types";

interface ModelFileDefinition {
  fileName: string;
  size: number;
  sha256?: string;
  url: string;
}

interface ModelDefinition {
  id: ManagedModelId;
  engine: TranscriptionEngine;
  modelName: WhisperCppModel | FasterWhisperModel;
  displayName: string;
  description: string;
  hardwareHint: string;
  languageHint: string;
  version: string;
  recommended: boolean;
  files: ModelFileDefinition[];
}

type ProgressReporter = (progress: ModelDownloadProgress) => void;

const WHISPER_CPP_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";
const TURBO_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf";
const DISTIL_REVISION = "c3058b475261292e64a0412df1d2681c06260fab";

function huggingFaceUrl(repository: string, revision: string, fileName: string) {
  return `https://huggingface.co/${repository}/resolve/${revision}/${encodeURIComponent(fileName)}?download=true`;
}

function fasterWhisperFiles(repository: string, revision: string, sizes: Record<string, number>, modelSha256: string) {
  return ["config.json", "model.bin", "preprocessor_config.json", "tokenizer.json", "vocabulary.json"].map(
    (fileName): ModelFileDefinition => ({
      fileName,
      size: sizes[fileName],
      sha256: fileName === "model.bin" ? modelSha256 : undefined,
      url: huggingFaceUrl(repository, revision, fileName)
    })
  );
}

const MODEL_CATALOG: readonly ModelDefinition[] = [
  {
    id: "faster-whisper-large-v3-turbo",
    engine: "faster-whisper",
    modelName: "large-v3-turbo",
    displayName: "Large V3 Turbo",
    description: "中英文混合转写，速度与精度均衡。",
    hardwareHint: "建议 8 GB 内存",
    languageHint: "中英文推荐",
    version: "1",
    recommended: true,
    files: fasterWhisperFiles(
      "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
      TURBO_REVISION,
      {
        "config.json": 2263,
        "model.bin": 1617884929,
        "preprocessor_config.json": 340,
        "tokenizer.json": 2710337,
        "vocabulary.json": 1068114
      },
      "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da"
    )
  },
  {
    id: "faster-whisper-distil-large-v3",
    engine: "faster-whisper",
    modelName: "distil-large-v3",
    displayName: "Distil Large V3",
    description: "英文长音频优先，不建议用于中文。",
    hardwareHint: "低延迟",
    languageHint: "英语专项",
    version: "1",
    recommended: false,
    files: fasterWhisperFiles(
      "Systran/faster-distil-whisper-large-v3",
      DISTIL_REVISION,
      {
        "config.json": 2690,
        "model.bin": 1512927867,
        "preprocessor_config.json": 340,
        "tokenizer.json": 2480617,
        "vocabulary.json": 1068114
      },
      "b79368e19b6623813609431a6e5ee309a71506701ebc49fd7820e692dec7c5f5"
    )
  },
  {
    id: "whisper-cpp-small",
    engine: "whisper-cpp",
    modelName: "ggml-small",
    displayName: "Whisper Small",
    description: "适合 CPU 和低内存设备，运行开销较小。",
    hardwareHint: "低配置优先",
    languageHint: "轻量多语言",
    version: "1",
    recommended: false,
    files: [
      {
        fileName: "ggml-small.bin",
        size: 487601967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        url: huggingFaceUrl("ggerganov/whisper.cpp", WHISPER_CPP_REVISION, "ggml-small.bin")
      }
    ]
  },
  {
    id: "whisper-cpp-large-v3-q5_0",
    engine: "whisper-cpp",
    modelName: "ggml-large-v3-q5_0",
    displayName: "Large V3 Q5_0",
    description: "中英文高精度转写，耗时和内存占用较高。",
    hardwareHint: "建议 8 GB 内存",
    languageHint: "高精度多语言",
    version: "1",
    recommended: false,
    files: [
      {
        fileName: "ggml-large-v3-q5_0.bin",
        size: 1081140203,
        sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1",
        url: huggingFaceUrl("ggerganov/whisper.cpp", WHISPER_CPP_REVISION, "ggml-large-v3-q5_0.bin")
      }
    ]
  }
];

const activeDownloads = new Map<ManagedModelId, AbortController>();

export function isManagedModelId(value: unknown): value is ManagedModelId {
  return typeof value === "string" && MODEL_CATALOG.some((model) => model.id === value);
}

function definitionFor(modelId: ManagedModelId) {
  const definition = MODEL_CATALOG.find((model) => model.id === modelId);
  if (!definition) {
    throw new Error(`Unknown managed model: ${modelId}`);
  }
  return definition;
}

export function getModelsRoot() {
  return path.join(app.getPath("userData"), "models");
}

function modelDirectory(definition: ModelDefinition) {
  return path.join(getModelsRoot(), definition.engine, definition.modelName, definition.version);
}

function manualModelDirectory(definition: ModelDefinition) {
  return definition.engine === "whisper-cpp"
    ? getModelsRoot()
    : path.join(getModelsRoot(), definition.engine, definition.modelName);
}

function modelDirectories(definition: ModelDefinition) {
  return [modelDirectory(definition), manualModelDirectory(definition)];
}

function assertManagedPath(targetPath: string) {
  const root = path.resolve(getModelsRoot());
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Model path is outside the managed model directory.");
  }
}

async function fileMatches(filePath: string, expectedSize: number) {
  const stat = await fs.stat(filePath).catch(() => null);
  return Boolean(stat?.isFile() && stat.size === expectedSize);
}

async function directoryHasModel(definition: ModelDefinition, directory: string) {
  const checks = await Promise.all(
    definition.files.map((file) => fileMatches(path.join(directory, file.fileName), file.size))
  );
  return checks.every(Boolean);
}

async function findInstalledModelDirectory(definition: ModelDefinition) {
  for (const directory of modelDirectories(definition)) {
    if (await directoryHasModel(definition, directory)) {
      return directory;
    }
  }
  return "";
}

async function modelIsInstalled(definition: ModelDefinition) {
  return Boolean(await findInstalledModelDirectory(definition));
}

export async function getManagedModels(): Promise<ManagedModelInfo[]> {
  return Promise.all(MODEL_CATALOG.map(async (definition) => {
    const installedDirectory = await findInstalledModelDirectory(definition);
    return {
      id: definition.id,
      engine: definition.engine,
      modelName: definition.modelName,
      displayName: definition.displayName,
      description: definition.description,
      hardwareHint: definition.hardwareHint,
      languageHint: definition.languageHint,
      sizeBytes: definition.files.reduce((total, file) => total + file.size, 0),
      installed: Boolean(installedDirectory),
      recommended: definition.recommended,
      installationPath: installedDirectory || modelDirectory(definition)
    };
  }));
}

export function whisperCppManagedModelId(model: WhisperCppModel): ManagedModelId {
  return model === "ggml-large-v3-q5_0" ? "whisper-cpp-large-v3-q5_0" : "whisper-cpp-small";
}

export function fasterWhisperManagedModelId(model: FasterWhisperModel): ManagedModelId {
  return model === "distil-large-v3"
    ? "faster-whisper-distil-large-v3"
    : "faster-whisper-large-v3-turbo";
}

export async function resolveManagedModelPath(modelId: ManagedModelId) {
  const definition = definitionFor(modelId);
  const directory = await findInstalledModelDirectory(definition);
  if (!directory) {
    return "";
  }
  return definition.engine === "whisper-cpp"
    ? path.join(directory, definition.files[0].fileName)
    : directory;
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return hash.digest("hex");
}

async function verifyAndInstallFile(
  definition: ModelDefinition,
  file: ModelFileDefinition,
  partPath: string,
  targetPath: string,
  completedBeforeFile: number,
  totalBytes: number,
  report: ProgressReporter
) {
  if (!(await fileMatches(partPath, file.size))) {
    const actualSize = (await fs.stat(partPath).catch(() => null))?.size ?? 0;
    throw new Error(`${file.fileName} 大小校验失败：预期 ${file.size}，实际 ${actualSize}。`);
  }
  if (file.sha256) {
    report(progressEvent(
      definition.id,
      "verifying",
      completedBeforeFile + file.size,
      totalBytes,
      `正在校验 ${definition.displayName}`
    ));
    const actualHash = await sha256File(partPath);
    if (actualHash !== file.sha256) {
      await fs.rm(partPath, { force: true });
      throw new Error(`${file.fileName} SHA-256 校验失败，已删除无效下载。`);
    }
  }
  await fs.rm(targetPath, { force: true });
  await fs.rename(partPath, targetPath);
}

function progressEvent(
  modelId: ManagedModelId,
  phase: ModelDownloadProgress["phase"],
  transferredBytes: number,
  totalBytes: number,
  message: string
): ModelDownloadProgress {
  return {
    modelId,
    phase,
    transferredBytes,
    totalBytes,
    percent: totalBytes > 0 ? Math.min(100, transferredBytes * 100 / totalBytes) : 0,
    message
  };
}

async function downloadFile(
  definition: ModelDefinition,
  file: ModelFileDefinition,
  completedBeforeFile: number,
  totalBytes: number,
  controller: AbortController,
  report: ProgressReporter
) {
  const directory = modelDirectory(definition);
  const targetPath = path.join(directory, file.fileName);
  const partPath = `${targetPath}.part`;
  assertManagedPath(targetPath);
  await fs.mkdir(directory, { recursive: true });

  if (await fileMatches(targetPath, file.size)) {
    report(progressEvent(definition.id, "downloading", completedBeforeFile + file.size, totalBytes, `已存在 ${file.fileName}`));
    return;
  }

  const partialStat = await fs.stat(partPath).catch(() => null);
  let downloadedBytes = partialStat?.isFile() ? partialStat.size : 0;
  if (downloadedBytes > file.size) {
    await fs.rm(partPath, { force: true });
    downloadedBytes = 0;
  }
  if (downloadedBytes === file.size) {
    await verifyAndInstallFile(
      definition,
      file,
      partPath,
      targetPath,
      completedBeforeFile,
      totalBytes,
      report
    );
    return;
  }

  const headers = downloadedBytes > 0 ? { Range: `bytes=${downloadedBytes}-` } : undefined;
  let response = await net.fetch(file.url, { headers, signal: controller.signal });
  if (downloadedBytes > 0 && response.status === 200) {
    await fs.rm(partPath, { force: true });
    downloadedBytes = 0;
    response = await net.fetch(file.url, { signal: controller.signal });
  }
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`下载 ${file.fileName} 失败：HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`下载 ${file.fileName} 失败：服务器未返回文件内容。`);
  }

  const handle = await fs.open(partPath, downloadedBytes > 0 ? "a" : "w");
  const reader = response.body.getReader();
  let lastReportedAt = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      await handle.write(chunk);
      downloadedBytes += chunk.byteLength;
      const now = Date.now();
      if (now - lastReportedAt >= 120) {
        lastReportedAt = now;
        report(progressEvent(
          definition.id,
          "downloading",
          completedBeforeFile + downloadedBytes,
          totalBytes,
          `正在下载 ${definition.displayName}`
        ));
      }
    }
  } finally {
    reader.releaseLock();
    await handle.close();
  }

  await verifyAndInstallFile(
    definition,
    file,
    partPath,
    targetPath,
    completedBeforeFile,
    totalBytes,
    report
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

export async function downloadManagedModel(modelId: ManagedModelId, report: ProgressReporter) {
  if (activeDownloads.has(modelId)) {
    throw new Error("该模型已经在下载中。");
  }
  const definition = definitionFor(modelId);
  const controller = new AbortController();
  const totalBytes = definition.files.reduce((total, file) => total + file.size, 0);
  activeDownloads.set(modelId, controller);
  try {
    const root = getModelsRoot();
    await fs.mkdir(root, { recursive: true });
    const remainingBytes = (await Promise.all(definition.files.map(async (file) => {
      const target = path.join(modelDirectory(definition), file.fileName);
      if (await fileMatches(target, file.size)) return 0;
      const partial = await fs.stat(`${target}.part`).catch(() => null);
      return Math.max(0, file.size - (partial?.isFile() ? partial.size : 0));
    }))).reduce((total, size) => total + size, 0);
    const disk = await fs.statfs(root);
    const availableBytes = disk.bavail * disk.bsize;
    const requiredBytes = Math.ceil(remainingBytes * 1.05);
    if (availableBytes < requiredBytes) {
      throw new Error(`模型下载空间不足：至少需要 ${Math.ceil(requiredBytes / 1024 ** 2)} MB 可用空间。`);
    }
    let completedBytes = 0;
    for (const file of definition.files) {
      await downloadFile(definition, file, completedBytes, totalBytes, controller, report);
      completedBytes += file.size;
    }
    report(progressEvent(modelId, "completed", totalBytes, totalBytes, `${definition.displayName} 已安装`));
  } catch (error) {
    if (isAbortError(error)) {
      report(progressEvent(modelId, "cancelled", 0, totalBytes, `${definition.displayName} 下载已暂停`));
      return;
    }
    report(progressEvent(
      modelId,
      "failed",
      0,
      totalBytes,
      error instanceof Error ? error.message : String(error)
    ));
    throw error;
  } finally {
    activeDownloads.delete(modelId);
  }
}

export function cancelManagedModelDownload(modelId: ManagedModelId) {
  const controller = activeDownloads.get(modelId);
  if (!controller) return false;
  controller.abort();
  return true;
}

function bundledResourceRoots() {
  return [
    path.join(process.resourcesPath, "resources", "models"),
    path.join(process.resourcesPath, "models")
  ];
}

async function copyLegacyModel(source: string, definition: ModelDefinition) {
  if (!(await fs.stat(source).catch(() => null))) return;
  const destination = modelDirectory(definition);
  if (await modelIsInstalled(definition)) return;
  await fs.mkdir(destination, { recursive: true });
  const sourceStat = await fs.stat(source);
  if (sourceStat.isDirectory()) {
    await fs.cp(source, destination, { recursive: true, force: false });
  } else {
    await fs.copyFile(source, path.join(destination, definition.files[0].fileName));
  }
}

export async function migrateBundledModels() {
  if (!app.isPackaged) return;
  const small = definitionFor("whisper-cpp-small");
  const distil = definitionFor("faster-whisper-distil-large-v3");
  for (const root of bundledResourceRoots()) {
    await copyLegacyModel(path.join(root, "ggml-small.bin"), small).catch(() => undefined);
    await copyLegacyModel(path.join(root, "faster-whisper", "distil-large-v3"), distil).catch(() => undefined);
  }
}
