export type AppTheme = "system" | "light" | "dark";
export type CloseBehavior = "tray" | "quit";
export type TranscriptLanguage = "auto" | "zh" | "en";
export type ExportFormat = "txt" | "srt" | "json";
export type TranscriptionStage = "queued" | "normalizing" | "transcribing" | "finalizing" | "completed" | "failed" | "cancelled";

export interface AppPreferences {
  theme: AppTheme;
  closeBehavior: CloseBehavior;
  defaultLanguage: TranscriptLanguage;
  exportDirectory: string;
  whisperExecutablePath: string;
  ffmpegExecutablePath: string;
  modelPath: string;
  disableGpu: boolean;
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
  getPreferences(): Promise<AppPreferences>;
  savePreferences(next: AppPreferences): Promise<AppPreferences>;
  selectAudioFile(): Promise<string | null>;
  selectWhisperExecutable(): Promise<string | null>;
  selectFfmpegExecutable(): Promise<string | null>;
  selectModelFile(): Promise<string | null>;
  selectExportDirectory(): Promise<string | null>;
  transcribeRecording(input: RecordingTranscriptionRequest): Promise<TranscriptionResult>;
  transcribeFile(filePath: string, language: TranscriptLanguage): Promise<TranscriptionResult>;
  cancelTranscription(): Promise<boolean>;
  onTranscriptionProgress(callback: (event: TranscriptionProgressEvent) => void): () => void;
  exportRecordingAudio(input: RecordingAudioExportRequest): Promise<string | null>;
  exportTranscript(document: TranscriptDocument, format: ExportFormat): Promise<string | null>;
  revealPath(filePath: string): Promise<void>;
}
