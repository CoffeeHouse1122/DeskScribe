import type { FasterWhisperModel, TranscriptLanguage } from "../shared/types";

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
