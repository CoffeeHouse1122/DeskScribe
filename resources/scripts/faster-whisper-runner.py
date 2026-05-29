import argparse
import json
import logging
import os
import warnings
import wave

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

warnings.filterwarnings(
    "ignore",
    message=r"You are sending unauthenticated requests to the HF Hub.*",
)
warnings.filterwarnings(
    "ignore",
    category=UserWarning,
    module=r"huggingface_hub.*",
)
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

def audio_duration_ms(path: str) -> int:
    with wave.open(path, "rb") as audio:
        frames = audio.getnframes()
        rate = audio.getframerate()
        if rate <= 0:
            return 0
        return int(frames * 1000 / rate)


def audio_rms(path: str) -> int:
    with wave.open(path, "rb") as audio:
        frames = audio.readframes(audio.getnframes())
        width = audio.getsampwidth()
        if not frames or width <= 0:
            return 0
        sample_count = len(frames) // width
        if sample_count <= 0:
            return 0
        total = 0
        for offset in range(0, len(frames) - width + 1, width):
            sample = int.from_bytes(frames[offset:offset + width], "little", signed=True)
            total += sample * sample
        return int((total / sample_count) ** 0.5)


def resolve_model(model_name: str, model_dir: str | None) -> str:
    if not model_dir:
        raise RuntimeError("Missing bundled Faster-Whisper model directory.")

    target_dir = os.path.join(model_dir, model_name)
    model_bin = os.path.join(target_dir, "model.bin")
    if os.path.exists(model_bin):
        return target_dir

    raise RuntimeError(
        f"Bundled Faster-Whisper model is missing model.bin: {target_dir}"
    )


def collect_segments(model, audio_path: str, language, duration_ms: int, permissive: bool):
    segments_iter, info = model.transcribe(
        audio_path,
        language=language,
        task="transcribe",
        beam_size=5 if permissive else 1,
        vad_filter=False,
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
    )

    segments = []
    for segment in segments_iter:
        start_ms = int(segment.start * 1000)
        end_ms = int(segment.end * 1000)
        text = segment.text.strip()
        if text:
            segments.append({
                "startMs": start_ms,
                "endMs": end_ms,
                "text": text
            })
        if duration_ms > 0:
            progress = max(0, min(100, round(end_ms * 100 / duration_ms, 1)))
            print(f"progress = {progress}%", flush=True)
    return segments, info


def main() -> int:
    parser = argparse.ArgumentParser(description="DeskScribe Faster-Whisper runner")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--model-dir", default="")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise SystemExit(
            "Missing faster-whisper. Install with: pip install faster-whisper"
        ) from exc

    duration_ms = audio_duration_ms(args.audio)
    if duration_ms > 0 and audio_rms(args.audio) < 32:
        result = {
            "text": "",
            "segments": [],
            "engine": {
                "name": "faster-whisper",
                "model": args.model,
                "detectedLanguage": None
            }
        }
        with open(args.output, "w", encoding="utf-8") as output:
            json.dump(result, output, ensure_ascii=False, indent=2)
        print("progress = 100%", flush=True)
        return 0

    device = "cuda" if args.device == "auto" else args.device
    compute_type = "float16" if args.compute_type == "auto" and device == "cuda" else args.compute_type
    if compute_type == "auto":
        compute_type = "int8"

    model_name = resolve_model(args.model, args.model_dir or None)
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    language = None if args.language == "auto" else args.language
    segments, info = collect_segments(model, args.audio, language, duration_ms, permissive=False)
    if not segments:
        print("progress = 50%", flush=True)
        segments, info = collect_segments(model, args.audio, language, duration_ms, permissive=True)

    result = {
        "text": "\n".join(segment["text"] for segment in segments),
        "segments": segments,
        "engine": {
            "name": "faster-whisper",
            "model": model_name,
            "detectedLanguage": getattr(info, "language", None)
        }
    }
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    print("progress = 100%", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
