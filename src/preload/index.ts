import { contextBridge, ipcRenderer } from "electron";
import type {
  AppPreferences,
  ExportFormat,
  RecordingAudioExportRequest,
  RecordingTranscriptionRequest,
  RendererApi,
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
  getPreferences: () => ipcRenderer.invoke("preferences:get"),
  savePreferences: (next: AppPreferences) => ipcRenderer.invoke("preferences:save", next),
  selectAudioFile: () => ipcRenderer.invoke("dialog:audio-file"),
  selectWhisperExecutable: () => ipcRenderer.invoke("dialog:whisper-file"),
  selectFfmpegExecutable: () => ipcRenderer.invoke("dialog:ffmpeg-file"),
  selectModelFile: () => ipcRenderer.invoke("dialog:model-file"),
  selectExportDirectory: () => ipcRenderer.invoke("dialog:export-directory"),
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
