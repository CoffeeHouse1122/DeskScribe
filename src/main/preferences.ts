import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppPreferences, FasterWhisperModel, TranscriptionEngine, WhisperCppModel } from "../shared/types";

const SETTINGS_FILE = "preferences.json";

export function getDefaultPreferences(): AppPreferences {
  return {
    theme: "system",
    closeBehavior: "tray",
    defaultLanguage: "auto",
    exportDirectory: app.getPath("documents"),
    whisperExecutablePath: "",
    ffmpegExecutablePath: "",
    modelPath: "",
    disableGpu: true,
    transcriptionEngine: "faster-whisper",
    whisperCppModel: "ggml-small",
    fasterWhisperModel: "large-v3-turbo",
    whisperThreads: 4
  };
}

function transcriptionEngine(value: unknown): TranscriptionEngine {
  return value === "whisper-cpp" || value === "faster-whisper" ? value : "faster-whisper";
}

function whisperCppModel(value: unknown): WhisperCppModel {
  return value === "ggml-large-v3-q5_0" ? value : "ggml-small";
}

function fasterWhisperModel(value: unknown): FasterWhisperModel {
  return value === "distil-large-v3" ? value : "large-v3-turbo";
}

function normalizePreferences(value: Partial<AppPreferences>): AppPreferences {
  const defaults = getDefaultPreferences();
  return {
    ...defaults,
    ...value,
    transcriptionEngine: transcriptionEngine(value.transcriptionEngine),
    whisperCppModel: whisperCppModel(value.whisperCppModel),
    fasterWhisperModel: fasterWhisperModel(value.fasterWhisperModel)
  };
}

function settingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

export async function loadPreferences() {
  const defaults = getDefaultPreferences();
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    return normalizePreferences(parsed);
  } catch {
    return defaults;
  }
}

export async function savePreferences(next: AppPreferences) {
  const merged = normalizePreferences(next);
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
