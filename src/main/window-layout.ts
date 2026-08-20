import { BrowserWindow, screen } from "electron";
import type { WindowMode } from "../shared/types";

const COMPACT_SIZE = { width: 430, height: 760 };
const FULL_SIZE = { width: 1024, height: 640 };

export function getInitialWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return centeredBounds(workArea, COMPACT_SIZE);
}

export function applyWindowMode(window: BrowserWindow, mode: WindowMode) {
  const { workArea } = screen.getDisplayMatching(window.getBounds());
  const requestedSize = mode === "compact" ? COMPACT_SIZE : FULL_SIZE;
  const bounds = centeredBounds(workArea, requestedSize);

  if (window.isMaximized()) {
    window.unmaximize();
  }
  window.setResizable(true);
  window.setMaximumSize(10000, 10000);

  if (mode === "compact") {
    window.setMinimumSize(1, 1);
    window.setBounds(bounds, false);
    window.setMinimumSize(bounds.width, bounds.height);
    window.setMaximumSize(bounds.width, bounds.height);
    window.setMaximizable(false);
    window.setResizable(false);
    return;
  }

  window.setMinimumSize(Math.min(940, workArea.width), Math.min(620, workArea.height));
  window.setMaximizable(true);
  window.setBounds(bounds, false);
}

function centeredBounds(
  workArea: Electron.Rectangle,
  requestedSize: { width: number; height: number }
) {
  const width = Math.min(requestedSize.width, workArea.width);
  const height = Math.min(requestedSize.height, workArea.height);
  return {
    width,
    height,
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2)
  };
}
