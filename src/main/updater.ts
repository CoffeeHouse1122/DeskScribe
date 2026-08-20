import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { AppUpdateState } from "../shared/types";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let state: AppUpdateState = {
  phase: app.isPackaged ? "idle" : "disabled",
  currentVersion: app.getVersion(),
  message: app.isPackaged ? "尚未检查更新" : "开发模式不检查更新"
};
let initialized = false;
let checkTimer: NodeJS.Timeout | null = null;

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

export function installDownloadedUpdate() {
  if (state.phase !== "downloaded") {
    throw new Error("当前没有已下载的更新。");
  }
  autoUpdater.quitAndInstall(false, true);
}

export function initializeAutoUpdater() {
  if (initialized || !app.isPackaged) return;
  initialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    publishState({ phase: "checking", message: "正在检查更新", percent: undefined });
  });
  autoUpdater.on("update-available", (info) => {
    publishState({
      phase: "available",
      availableVersion: info.version,
      message: `发现 ${info.version}，正在后台下载`,
      percent: 0
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
      message: `${info.version} 已下载，退出应用时将自动安装`
    });
  });
  autoUpdater.on("error", (error) => {
    publishState({ phase: "error", message: `自动更新失败：${errorMessage(error)}` });
  });

  const initialTimer = setTimeout(() => {
    void checkForUpdates();
  }, 12_000);
  initialTimer.unref();
  checkTimer = setInterval(() => {
    void checkForUpdates();
  }, CHECK_INTERVAL_MS);
  checkTimer.unref();
}

export function shutdownAutoUpdater() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}
