import { dialog, ipcMain, shell } from "electron";
import path from "node:path";
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
  ExportFormat,
  RecordingAudioExportRequest,
  RecordingTranscriptionRequest,
  TranscriptDocument,
  TranscriptLanguage,
  TranscriptionProgressEvent
} from "../shared/types";

function audioFilters() {
  return [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm"] }];
}

let activeTranscription: TranscriptionController | null = null;

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

export function registerIpc() {
  ipcMain.handle("preferences:get", async () => loadPreferences());

  ipcMain.handle("preferences:save", async (_event, next: AppPreferences) => {
    return savePreferences(next);
  });

  ipcMain.handle("dialog:audio-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: audioFilters()
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:whisper-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Executable", extensions: process.platform === "win32" ? ["exe"] : ["*"] }]
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

  ipcMain.handle("dialog:model-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Model", extensions: ["bin", "gguf", "*"] }]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:export-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
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
