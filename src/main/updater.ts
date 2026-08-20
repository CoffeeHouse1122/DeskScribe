import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { AppUpdateState } from "../shared/types";

let state: AppUpdateState = {
  phase: app.isPackaged ? "idle" : "disabled",
  currentVersion: app.getVersion(),
  message: app.isPackaged ? "尚未检查更新" : "开发模式不检查更新"
};
let initialized = false;
let initialCheckTimer: NodeJS.Timeout | null = null;

function publishState(next: Partial<AppUpdateState>) {
  state = { ...state, ...next, currentVersion: app.getVersion() };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("update:state", state);
    }
  }
}

function errorMessage(error: Error | string) {
  const raw = typeof error === "string" ? error : error.message;
  return raw.replace(/https?:\/\/[^\s]+/g, "更新服务器");
}

export function getUpdateState() {
  return state;
}

export async function checkForUpdates() {
  if (!app.isPackaged) return state;
  publishState({ phase: "checking", message: "正在检查更新", percent: undefined });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishState({ phase: "error", message: `检查更新失败：${errorMessage(error instanceof Error ? error : String(error))}` });
  }
  return state;
}

export async function downloadAvailableUpdate() {
  if (!app.isPackaged) return;
  if (state.phase !== "available") {
    throw new Error("当前没有可下载的更新。");
  }
  publishState({ phase: "downloading", message: "正在下载更新 0.0%", percent: 0 });
  await autoUpdater.downloadUpdate();
}

export function installDownloadedUpdate() {
  if (state.phase !== "downloaded") {
    throw new Error("当前没有已下载的更新。");
  }
  autoUpdater.quitAndInstall(false, true);
}

export function initializeAutoUpdater() {
  if (initialized || !app.isPackaged) return;
  initialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    publishState({ phase: "checking", message: "正在检查更新", percent: undefined });
  });
  autoUpdater.on("update-available", (info) => {
    publishState({
      phase: "available",
      availableVersion: info.version,
      message: `发现 ${info.version}，确认后即可下载`,
      percent: undefined
    });
  });
  autoUpdater.on("update-not-available", () => {
    publishState({ phase: "not-available", message: "当前已是最新版本", availableVersion: undefined, percent: undefined });
  });
  autoUpdater.on("download-progress", (progress) => {
    publishState({
      phase: "downloading",
      percent: progress.percent,
      message: `正在下载更新 ${progress.percent.toFixed(1)}%`
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishState({
      phase: "downloaded",
      availableVersion: info.version,
      percent: 100,
      message: `${info.version} 已下载，确认后即可安装`
    });
  });
  autoUpdater.on("error", (error) => {
    publishState({ phase: "error", message: `自动更新失败：${errorMessage(error)}` });
  });

  initialCheckTimer = setTimeout(() => {
    initialCheckTimer = null;
    void checkForUpdates();
  }, 12_000);
  initialCheckTimer.unref();
}

export function shutdownAutoUpdater() {
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer);
    initialCheckTimer = null;
  }
}
