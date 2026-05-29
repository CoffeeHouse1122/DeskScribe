import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppPreferences } from "../shared/types";

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
    transcriptionEngine: "whisper-cpp",
    fasterWhisperModel: "distil-large-v3",
    whisperThreads: 4
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
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export async function savePreferences(next: AppPreferences) {
  const merged = { ...getDefaultPreferences(), ...next };
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
