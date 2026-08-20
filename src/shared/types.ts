export type AppTheme = "system" | "light" | "dark";
export type CloseBehavior = "tray" | "quit";
export type TranscriptLanguage = "auto" | "zh" | "en";
export type ExportFormat = "txt" | "srt" | "json";
export type TranscriptionStage = "queued" | "normalizing" | "transcribing" | "finalizing" | "completed" | "failed" | "cancelled";
export type TranscriptionEngine = "whisper-cpp" | "faster-whisper";
export type FasterWhisperModel = "large-v3-turbo" | "distil-large-v3";
export type WhisperCppModel = "ggml-small" | "ggml-large-v3-q5_0";
export type ManagedModelId =
  | "whisper-cpp-small"
  | "whisper-cpp-large-v3-q5_0"
  | "faster-whisper-large-v3-turbo"
  | "faster-whisper-distil-large-v3";
export type WindowMode = "compact" | "full";

export interface AppPreferences {
  theme: AppTheme;
  closeBehavior: CloseBehavior;
  defaultLanguage: TranscriptLanguage;
  exportDirectory: string;
  whisperExecutablePath: string;
  ffmpegExecutablePath: string;
  modelPath: string;
  disableGpu: boolean;
  transcriptionEngine: TranscriptionEngine;
  whisperCppModel: WhisperCppModel;
  fasterWhisperModel: FasterWhisperModel;
  whisperThreads: number;
}

export interface ManagedModelInfo {
  id: ManagedModelId;
  engine: TranscriptionEngine;
  modelName: WhisperCppModel | FasterWhisperModel;
  displayName: string;
  description: string;
  hardwareHint: string;
  languageHint: string;
  sizeBytes: number;
  installed: boolean;
  recommended: boolean;
  installationPath: string;
}

export type ModelDownloadPhase = "downloading" | "verifying" | "completed" | "cancelled" | "failed";

export interface ModelDownloadProgress {
  modelId: ManagedModelId;
  phase: ModelDownloadPhase;
  transferredBytes: number;
  totalBytes: number;
  percent: number;
  message: string;
}

export type UpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export interface AppUpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  message: string;
}

export interface TranscriptSegment {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptDocument {
  version: number;
  source: {
    type: "recording" | "file";
    fileName: string;
    durationMs?: number;
    language: TranscriptLanguage | string;
  };
  text: string;
  segments: TranscriptSegment[];
  createdAt: string;
  engine: {
    name: string;
    model: string;
    detectedLanguage?: string;
  };
}

export interface TranscriptionResult {
  document: TranscriptDocument;
  outputPath: string;
  normalizedPath: string;
  logs: string[];
}

export interface TranscriptionProgressEvent {
  stage: TranscriptionStage;
  message: string;
  detail?: string;
  progress?: number;
  elapsedMs?: number;
}

export interface TranscriptionRequest {
  language: TranscriptLanguage;
}

export interface RecordingTranscriptionRequest extends TranscriptionRequest {
  fileName?: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface RecordingAudioExportRequest {
  fileName?: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface RendererApi {
  setWindowMode(mode: WindowMode): Promise<void>;
  toggleAlwaysOnTop(): Promise<boolean>;
  toggleMaximizeWindow(): Promise<boolean>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  reloadWindow(): Promise<void>;
  getPreferences(): Promise<AppPreferences>;
  savePreferences(next: AppPreferences): Promise<AppPreferences>;
  selectAudioFile(): Promise<string | null>;
  selectWhisperExecutable(): Promise<string | null>;
  selectFfmpegExecutable(): Promise<string | null>;
  selectModelFile(): Promise<string | null>;
  selectExportDirectory(): Promise<string | null>;
  getManagedModels(): Promise<ManagedModelInfo[]>;
  downloadManagedModel(modelId: ManagedModelId): Promise<void>;
  cancelManagedModelDownload(modelId: ManagedModelId): Promise<boolean>;
  deleteManagedModel(modelId: ManagedModelId): Promise<void>;
  openModelsDirectory(): Promise<void>;
  onModelDownloadProgress(callback: (progress: ModelDownloadProgress) => void): () => void;
  getUpdateState(): Promise<AppUpdateState>;
  checkForUpdates(): Promise<AppUpdateState>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: AppUpdateState) => void): () => void;
  transcribeRecording(input: RecordingTranscriptionRequest): Promise<TranscriptionResult>;
  transcribeFile(filePath: string, language: TranscriptLanguage): Promise<TranscriptionResult>;
  cancelTranscription(): Promise<boolean>;
  onTranscriptionProgress(callback: (event: TranscriptionProgressEvent) => void): () => void;
  exportRecordingAudio(input: RecordingAudioExportRequest): Promise<string | null>;
  exportTranscript(document: TranscriptDocument, format: ExportFormat): Promise<string | null>;
  revealPath(filePath: string): Promise<void>;
}
