import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cancelManagedModelDownload,
  deleteManagedModel,
  downloadManagedModel,
  getManagedModels,
  getModelsRoot,
  isManagedModelId
} from "./model-manager";
import { checkForUpdates, downloadAvailableUpdate, getUpdateState, installDownloadedUpdate } from "./updater";
import {
  TranscriptionController,
  exportRecordingAudio,
  exportTranscript,
  isTranscriptionCancelled,
  transcribeFile,
  transcribeRecording
} from "./transcription";
import { loadPreferences, savePreferences } from "./preferences";
import type {
  AppPreferences,
  ManagedModelId,
  ExportFormat,
  RecordingAudioExportRequest,
  RecordingTranscriptionRequest,
  TranscriptDocument,
  TranscriptLanguage,
  TranscriptionProgressEvent,
  WindowMode
} from "../shared/types";
import { applyWindowMode } from "./window-layout";

interface IpcHandlers {
  onPreferencesSaved?: (preferences: AppPreferences) => void | Promise<void>;
}

function audioFilters() {
  return [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm"] }];
}

let activeTranscription: TranscriptionController | null = null;

function assertTrustedSender(event: Electron.IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) {
    throw new Error("Rejected IPC request from an unknown window.");
  }
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl) {
    throw new Error("Rejected IPC request without a sender frame.");
  }
  const trusted = process.env.VITE_DEV_SERVER_URL
    ? senderUrl.startsWith(process.env.VITE_DEV_SERVER_URL)
    : senderUrl.startsWith("file://");
  if (!trusted) {
    throw new Error("Rejected IPC request from an untrusted page.");
  }
}

function managedModelId(value: unknown): ManagedModelId {
  if (!isManagedModelId(value)) {
    throw new Error("Invalid managed model identifier.");
  }
  return value;
}

function createProgressReporter(event: Electron.IpcMainInvokeEvent) {
  return (progress: TranscriptionProgressEvent) => {
    event.sender.send("transcription:progress", progress);
  };
}

function createController() {
  if (activeTranscription) {
    throw new Error("已有转写任务正在执行，请先取消或等待完成。");
  }
  activeTranscription = new TranscriptionController();
  return activeTranscription;
}

export function registerIpc(handlers: IpcHandlers = {}) {
  ipcMain.handle("window:set-mode", (event, mode: WindowMode) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || (mode !== "compact" && mode !== "full")) return;
    applyWindowMode(window, mode);
  });

  ipcMain.handle("window:toggle-always-on-top", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    const next = !window.isAlwaysOnTop();
    window.setAlwaysOnTop(next);
    return next;
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !window.isMaximizable()) return false;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return window.isMaximized();
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:reload", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.reloadIgnoringCache();
  });

  ipcMain.handle("preferences:get", async () => loadPreferences());

  ipcMain.handle("preferences:save", async (_event, next: AppPreferences) => {
    const saved = await savePreferences(next);
    await handlers.onPreferencesSaved?.(saved);
    return saved;
  });

  ipcMain.handle("dialog:audio-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: audioFilters()
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:ffmpeg-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Executable", extensions: process.platform === "win32" ? ["exe"] : ["*"] }]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:export-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("models:list", async (event) => {
    assertTrustedSender(event);
    return getManagedModels();
  });

  ipcMain.handle("models:download", async (event, value: unknown) => {
    assertTrustedSender(event);
    const modelId = managedModelId(value);
    await downloadManagedModel(modelId, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("models:download-progress", progress);
      }
    });
  });

  ipcMain.handle("models:cancel-download", (event, value: unknown) => {
    assertTrustedSender(event);
    return cancelManagedModelDownload(managedModelId(value));
  });

  ipcMain.handle("models:delete", async (event, value: unknown) => {
    assertTrustedSender(event);
    await deleteManagedModel(managedModelId(value));
  });

  ipcMain.handle("models:open-directory", async (event) => {
    assertTrustedSender(event);
    const modelsRoot = getModelsRoot();
    await fs.mkdir(modelsRoot, { recursive: true });
    const error = await shell.openPath(modelsRoot);
    if (error) throw new Error(error);
  });

  ipcMain.handle("update:get-state", (event) => {
    assertTrustedSender(event);
    return getUpdateState();
  });

  ipcMain.handle("update:check", async (event) => {
    assertTrustedSender(event);
    return checkForUpdates();
  });

  ipcMain.handle("update:download", async (event) => {
    assertTrustedSender(event);
    await downloadAvailableUpdate();
  });

  ipcMain.handle("update:install", (event) => {
    assertTrustedSender(event);
    installDownloadedUpdate();
  });

  ipcMain.handle("transcription:recording", async (event, input: RecordingTranscriptionRequest) => {
    const preferences = await loadPreferences();
    const report = createProgressReporter(event);
    const controller = createController();
    try {
      return await transcribeRecording(input, preferences, report, controller);
    } catch (error) {
      if (isTranscriptionCancelled(error)) {
        report({ stage: "cancelled", message: "已取消转写", progress: 100 });
        throw error;
      }
      report({ stage: "failed", message: error instanceof Error ? error.message : String(error), progress: 100 });
      throw error;
    } finally {
      if (activeTranscription === controller) {
        activeTranscription = null;
      }
    }
  });

  ipcMain.handle("transcription:file", async (event, filePath: string, language: TranscriptLanguage) => {
    const preferences = await loadPreferences();
    const report = createProgressReporter(event);
    const controller = createController();
    try {
      return await transcribeFile(filePath, language, preferences, report, controller);
    } catch (error) {
      if (isTranscriptionCancelled(error)) {
        report({ stage: "cancelled", message: "已取消转写", progress: 100 });
        throw error;
      }
      report({ stage: "failed", message: error instanceof Error ? error.message : String(error), progress: 100 });
      throw error;
    } finally {
      if (activeTranscription === controller) {
        activeTranscription = null;
      }
    }
  });

  ipcMain.handle("transcription:cancel", async () => {
    if (!activeTranscription) {
      return false;
    }
    activeTranscription.cancel();
    return true;
  });

  ipcMain.handle("transcription:export", async (_event, document: TranscriptDocument, format: ExportFormat) => {
    const preferences = await loadPreferences();
    const baseName = path.parse(document.source.fileName).name || "transcript";
    const defaultPath = path.join(preferences.exportDirectory, `${baseName}.${format}`);
    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await exportTranscript(document, result.filePath, format);
    return result.filePath;
  });

  ipcMain.handle("recording:export-audio", async (_event, input: RecordingAudioExportRequest) => {
    const preferences = await loadPreferences();
    const baseName = path.parse(input.fileName || "recording").name || "recording";
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(preferences.exportDirectory, `${baseName}.mp3`),
      filters: [{ name: "MP3", extensions: ["mp3"] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    const exported = await exportRecordingAudio(input, result.filePath);
    return exported.outputPath;
  });

  ipcMain.handle("shell:reveal-path", async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
}
