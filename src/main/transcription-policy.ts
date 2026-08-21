import type { FasterWhisperModel, TranscriptLanguage, TranscriptionStage } from "../shared/types";

export function fasterWhisperSupportsLanguage(
  model: FasterWhisperModel,
  language: TranscriptLanguage
) {
  return model !== "distil-large-v3" || language === "en";
}

export function advanceTranscriptionProgress(current: number, next: number | undefined) {
  if (next === undefined || !Number.isFinite(next)) {
    return current;
  }
  return Math.max(current, Math.max(0, Math.min(100, next)));
}

function timestampLabel(now: Date) {
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function shortDuration(timeMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatRuntimeProgressDetail(
  line: string,
  stage: TranscriptionStage,
  now = new Date()
) {
  const prefix = `[${timestampLabel(now)}]`;
  const segment = line.match(/\[([^\]]+?)\s*-->\s*([^\]]+?)\]\s*([^\r\n]*)/);
  if (segment) {
    const text = segment[3]?.trim();
    return `${prefix} 识别片段 ${segment[1]?.trim()}–${segment[2]?.trim()}${text ? `：${text}` : ""}`;
  }

  const ffmpegTime = line.match(/time=\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/i)?.[1];
  const speed = line.match(/speed=\s*([\d.]+)x/i)?.[1];
  if (ffmpegTime) {
    return `${prefix} 音频转换进度 ${ffmpegTime}${speed ? `，处理速度 ${speed} 倍` : ""}`;
  }

  const percent = line.match(/(?:progress\s*=\s*|^|\s)(\d{1,3}(?:\.\d+)?)\s*%/i)?.[1];
  if (percent) {
    return `${prefix} 语音识别进度 ${Math.round(Number(percent))}%`;
  }

  return `${prefix} ${stage === "normalizing" ? "正在转换音频格式" : "识别引擎正在处理音频"}`;
}

export function formatProgressStatusDetail(
  message: string,
  percent: number,
  elapsedMs: number,
  now = new Date()
) {
  return `[${timestampLabel(now)}] ${message}，当前进度 ${Math.round(percent)}%，本阶段用时 ${shortDuration(elapsedMs)}`;
}
