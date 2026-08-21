import { contextBridge, ipcRenderer } from "electron";
import type {
  AppPreferences,
  AppUpdateState,
  ExportFormat,
  ManagedModelId,
  ManagedModelInfo,
  ModelDownloadProgress,
  RecordingAudioExportRequest,
  RecordingTranscriptionRequest,
  RendererApi,
  SystemMetrics,
  TranscriptDocument,
  TranscriptLanguage,
  TranscriptionProgressEvent,
  WindowMode
} from "../shared/types";

const api: RendererApi = {
  setWindowMode: (mode: WindowMode) => ipcRenderer.invoke("window:set-mode", mode),
  toggleAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-always-on-top"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  reloadWindow: () => ipcRenderer.invoke("window:reload"),
  getSystemMetrics: () => ipcRenderer.invoke("system:metrics") as Promise<SystemMetrics>,
  getPreferences: () => ipcRenderer.invoke("preferences:get"),
  savePreferences: (next: AppPreferences) => ipcRenderer.invoke("preferences:save", next),
  selectAudioFile: () => ipcRenderer.invoke("dialog:audio-file"),
  selectFfmpegExecutable: () => ipcRenderer.invoke("dialog:ffmpeg-file"),
  selectExportDirectory: () => ipcRenderer.invoke("dialog:export-directory"),
  getManagedModels: () => ipcRenderer.invoke("models:list") as Promise<ManagedModelInfo[]>,
  downloadManagedModel: (modelId: ManagedModelId) => ipcRenderer.invoke("models:download", modelId),
  cancelManagedModelDownload: (modelId: ManagedModelId) => ipcRenderer.invoke("models:cancel-download", modelId),
  openModelsDirectory: () => ipcRenderer.invoke("models:open-directory"),
  onModelDownloadProgress: (callback: (progress: ModelDownloadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ModelDownloadProgress) => callback(progress);
    ipcRenderer.on("models:download-progress", listener);
    return () => ipcRenderer.removeListener("models:download-progress", listener);
  },
  getUpdateState: () => ipcRenderer.invoke("update:get-state") as Promise<AppUpdateState>,
  checkForUpdates: () => ipcRenderer.invoke("update:check") as Promise<AppUpdateState>,
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (callback: (state: AppUpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppUpdateState) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  transcribeRecording: (input: RecordingTranscriptionRequest) => ipcRenderer.invoke("transcription:recording", input),
  transcribeFile: (filePath: string, language: TranscriptLanguage) => ipcRenderer.invoke("transcription:file", filePath, language),
  cancelTranscription: () => ipcRenderer.invoke("transcription:cancel"),
  onTranscriptionProgress: (callback: (event: TranscriptionProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: TranscriptionProgressEvent) => callback(progress);
    ipcRenderer.on("transcription:progress", listener);
    return () => ipcRenderer.removeListener("transcription:progress", listener);
  },
  exportRecordingAudio: (input: RecordingAudioExportRequest) => ipcRenderer.invoke("recording:export-audio", input),
  exportTranscript: (document: TranscriptDocument, format: ExportFormat) => ipcRenderer.invoke("transcription:export", document, format),
  revealPath: (filePath: string) => ipcRenderer.invoke("shell:reveal-path", filePath)
};

contextBridge.exposeInMainWorld("deskScribe", api);
