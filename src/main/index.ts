import {
  app,
  BrowserWindow,
  desktopCapturer,
  Menu,
  session,
  Tray,
  nativeImage
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { registerIpc } from "./ipc";
import { loadPreferences } from "./preferences";
import { shutdownTranscriptionRuntime } from "./transcription";
import { getInitialWindowBounds } from "./window-layout";
import { migrateBundledModels } from "./model-manager";
import { initializeAutoUpdater, shutdownAutoUpdater } from "./updater";
import type { AppPreferences, CloseBehavior } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let closeBehavior: CloseBehavior = "tray";

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

function applyMainProcessPreferences(preferences: AppPreferences) {
  closeBehavior = preferences.closeBehavior;
}

function rendererUrl() {
  return process.env.VITE_DEV_SERVER_URL || `file://${path.join(app.getAppPath(), "dist/renderer/index.html")}`;
}

function iconPathCandidates() {
  const iconName = process.platform === "win32" ? "icon.ico" : "icon.png";
  return [
    path.join(process.resourcesPath, "resources", "icons", iconName),
    path.join(process.resourcesPath, "icons", iconName),
    path.join(app.getAppPath(), "resources", "icons", iconName),
    path.join(process.cwd(), "resources", "icons", iconName),
    path.resolve(__dirname, "..", "..", "resources", "icons", iconName)
  ];
}

function createAppIcon() {
  for (const candidate of iconPathCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) {
      image.setTemplateImage(false);
      return image;
    }
  }
  return createTrayImage();
}

function createTrayImage() {
  const size = 32;
  const buffer = Buffer.alloc(size * size * 4);

  function setPixel(x: number, y: number, red: number, green: number, blue: number, alpha = 255) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const index = (y * size + x) * 4;
    buffer[index] = blue;
    buffer[index + 1] = green;
    buffer[index + 2] = red;
    buffer[index + 3] = alpha;
  }

  function drawCircle(cx: number, cy: number, radius: number, red: number, green: number, blue: number, alpha = 255) {
    const radiusSquared = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
        const distanceSquared = (x - cx) ** 2 + (y - cy) ** 2;
        if (distanceSquared <= radiusSquared) {
          setPixel(x, y, red, green, blue, alpha);
        }
      }
    }
  }

  function drawLine(x1: number, y1: number, x2: number, y2: number, width: number, red: number, green: number, blue: number) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2;
    for (let step = 0; step <= steps; step += 1) {
      const rate = step / steps;
      const x = Math.round(x1 + (x2 - x1) * rate);
      const y = Math.round(y1 + (y2 - y1) * rate);
      drawCircle(x, y, width, red, green, blue);
    }
  }

  drawCircle(16, 16, 15, 245, 248, 255);
  drawCircle(16, 16, 13, 154, 226, 238);
  drawLine(10, 21, 21, 10, 2, 70, 92, 99);
  drawCircle(9, 10, 3, 70, 92, 99);
  drawCircle(10, 22, 3, 70, 92, 99);
  drawCircle(22, 9, 3, 70, 92, 99);
  drawCircle(22, 22, 2, 70, 92, 99);
  drawCircle(16, 16, 2, 70, 92, 99);

  const image = nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: 1 });
  image.setTemplateImage(false);
  return image;
}

async function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Open DeskScribe",
      click: () => {
        void showMainWindow();
      }
    },
    {
      label: closeBehavior === "tray" ? "Hide to Tray Enabled" : "Quit on Close Enabled",
      enabled: false
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
}

function configureDisplayMediaCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 }
      });
      const primaryScreen = sources[0];
      if (!primaryScreen) {
        callback({});
        return;
      }

      callback({
        video: request.videoRequested ? primaryScreen : undefined,
        audio: request.audioRequested && process.platform === "win32" ? "loopback" : undefined
      });
    } catch {
      callback({});
    }
  }, { useSystemPicker: true });
}

function attachWindowGuards(window: BrowserWindow) {
  window.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    if (closeBehavior === "tray") {
      event.preventDefault();
      window.hide();
    }
  });
}

async function createMainWindow() {
  const icon = createAppIcon();
  const initialBounds = getInitialWindowBounds();
  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: initialBounds.width,
    minHeight: initialBounds.height,
    maxWidth: initialBounds.width,
    maxHeight: initialBounds.height,
    resizable: false,
    maximizable: false,
    backgroundColor: "#f4f8ff",
    show: true,
    title: "DeskScribe",
    icon,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });

  attachWindowGuards(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(rendererUrl());
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"));
  }
}

async function createTray() {
  tray = new Tray(createAppIcon());
  tray.setToolTip("DeskScribe");
  tray.on("click", () => {
    void showMainWindow();
  });
  tray.on("double-click", () => {
    void showMainWindow();
  });
  refreshTray();
}

if (singleInstance) {
  app.on("second-instance", () => {
    void showMainWindow();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    shutdownTranscriptionRuntime();
    shutdownAutoUpdater();
  });

  app.on("activate", () => {
    void showMainWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("com.deskscribe.app");
    applyMainProcessPreferences(await loadPreferences());
    configureDisplayMediaCapture();
    registerIpc({
      onPreferencesSaved: async (preferences) => {
        applyMainProcessPreferences(preferences);
        refreshTray();
      }
    });
    await createMainWindow();
    await createTray();
    initializeAutoUpdater();
    void migrateBundledModels();
  });
}
