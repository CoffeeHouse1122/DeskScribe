import argparse
import json
import logging
import math
import os
import sys
import warnings
import wave

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

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


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def audio_duration_ms(path: str) -> int:
    with wave.open(path, "rb") as audio:
        frames = audio.getnframes()
        rate = audio.getframerate()
        if rate <= 0:
            return 0
        return int(frames * 1000 / rate)


def audio_rms(path: str) -> int:
    import numpy as np

    with wave.open(path, "rb") as audio:
        width = audio.getsampwidth()
        if width != 2:
            return 64

        square_sum = 0.0
        sample_count = 0
        while True:
            frames = audio.readframes(max(1, audio.getframerate() * 30))
            if not frames:
                break
            samples = np.frombuffer(frames, dtype="<i2").astype(np.float64)
            square_sum += float(np.dot(samples, samples))
            sample_count += int(samples.size)

        if sample_count <= 0:
            return 0
        return int(math.sqrt(square_sum / sample_count))


def resolve_model(model_name: str, model_dir: str | None) -> str:
    if not model_dir:
        raise RuntimeError("Missing Faster-Whisper model directory.")

    direct_model = os.path.join(model_dir, "model.bin")
    if os.path.exists(direct_model):
        return model_dir

    target_dir = os.path.join(model_dir, model_name)
    model_bin = os.path.join(target_dir, "model.bin")
    if os.path.exists(model_bin):
        return target_dir

    raise RuntimeError(
        f"Faster-Whisper model is missing model.bin: {target_dir}"
    )


def cuda_device_count() -> int:
    try:
        import ctranslate2

        return max(0, int(ctranslate2.get_cuda_device_count()))
    except Exception:
        return 0


class FasterWhisperRuntime:
    def __init__(
        self,
        model_name: str,
        requested_device: str,
        requested_compute_type: str,
        cpu_threads: int,
        num_workers: int,
        batch_size: int,
        event_callback=None,
    ) -> None:
        from faster_whisper import BatchedInferencePipeline, WhisperModel

        self.WhisperModel = WhisperModel
        self.BatchedInferencePipeline = BatchedInferencePipeline
        self.model_name = model_name
        self.requested_device = requested_device
        self.cpu_threads = max(0, cpu_threads)
        self.num_workers = max(1, num_workers)
        self.requested_batch_size = max(0, batch_size)
        self.event_callback = event_callback
        self.device = self._select_device(requested_device)
        self.compute_type = self._select_compute_type(
            requested_compute_type,
            self.device,
        )
        self.batch_size = self._select_batch_size(self.device)
        self.model = None
        self.pipeline = None
        self._load_with_cpu_fallback()

    @staticmethod
    def _select_device(requested_device: str) -> str:
        if requested_device == "auto":
            return "cuda" if cuda_device_count() > 0 else "cpu"
        return requested_device

    @staticmethod
    def _select_compute_type(requested_compute_type: str, device: str) -> str:
        if requested_compute_type != "auto":
            return requested_compute_type
        return "float16" if device == "cuda" else "int8"

    def _select_batch_size(self, device: str) -> int:
        if self.requested_batch_size > 0:
            return self.requested_batch_size
        if device == "cuda":
            return 4
        return 4 if self.cpu_threads >= 6 else 2

    def _emit_runtime(self, fallback_reason: str | None = None) -> None:
        event = {
            "type": "runtime",
            "device": self.device,
            "computeType": self.compute_type,
            "cpuThreads": self.cpu_threads,
            "numWorkers": self.num_workers,
            "batchSize": self.batch_size,
        }
        if fallback_reason:
            event["fallbackReason"] = fallback_reason
        if self.event_callback:
            self.event_callback(event)
        else:
            details = (
                f"device={self.device}, compute_type={self.compute_type}, "
                f"cpu_threads={self.cpu_threads}, batch_size={self.batch_size}"
            )
            if fallback_reason:
                details += f", CUDA fallback={fallback_reason}"
            print(f"runtime = {details}", flush=True)

    def _load(self) -> None:
        self.model = self.WhisperModel(
            self.model_name,
            device=self.device,
            compute_type=self.compute_type,
            cpu_threads=self.cpu_threads,
            num_workers=self.num_workers,
            local_files_only=True,
        )
        self.pipeline = (
            self.BatchedInferencePipeline(self.model)
            if self.batch_size > 1
            else None
        )

    def _load_with_cpu_fallback(self) -> None:
        try:
            self._load()
            self._emit_runtime()
        except Exception as exc:
            if self.device != "cuda" or self.requested_device != "auto":
                raise
            fallback_reason = str(exc)
            self.device = "cpu"
            self.compute_type = "int8"
            self.batch_size = self._select_batch_size(self.device)
            self._load()
            self._emit_runtime(fallback_reason)

    def fallback_to_cpu(self, reason: str) -> None:
        self.model = None
        self.pipeline = None
        self.device = "cpu"
        self.compute_type = "int8"
        self.batch_size = self._select_batch_size(self.device)
        self._load()
        self._emit_runtime(reason)

    def collect_segments(
        self,
        audio_path: str,
        language,
        duration_ms: int,
        progress_callback,
    ):
        transcriber = self.pipeline or self.model
        options = {
            "language": language,
            "task": "transcribe",
            "beam_size": 1,
            "best_of": 1,
            "vad_filter": True,
            "condition_on_previous_text": False,
            "without_timestamps": False,
            "no_speech_threshold": 0.6,
            "vad_parameters": {
                "threshold": 0.35,
                "min_speech_duration_ms": 100,
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 400,
            },
        }
        if self.pipeline:
            options["batch_size"] = self.batch_size

        segments_iter, info = transcriber.transcribe(audio_path, **options)
        segments = []
        for segment in segments_iter:
            start_ms = int(segment.start * 1000)
            end_ms = int(segment.end * 1000)
            text = segment.text.strip()
            if text:
                segments.append({
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "text": text,
                })
            if duration_ms > 0:
                progress = max(0, min(100, round(end_ms * 100 / duration_ms, 1)))
                progress_callback(progress)
        return segments, info

    def transcribe(self, audio_path: str, language, progress_callback):
        duration_ms = audio_duration_ms(audio_path)
        rms = audio_rms(audio_path)
        if duration_ms > 0 and rms < 32:
            progress_callback(100)
            return self.build_result([], None)

        try:
            segments, info = self.collect_segments(
                audio_path,
                language,
                duration_ms,
                progress_callback,
            )
        except Exception as exc:
            if self.device != "cuda" or self.requested_device != "auto":
                raise
            self.fallback_to_cpu(str(exc))
            segments, info = self.collect_segments(
                audio_path,
                language,
                duration_ms,
                progress_callback,
            )
        progress_callback(100)
        return self.build_result(segments, info)

    def build_result(self, segments, info):
        return {
            "text": "\n".join(segment["text"] for segment in segments),
            "segments": segments,
            "engine": {
                "name": "faster-whisper",
                "model": self.model_name,
                "detectedLanguage": getattr(info, "language", None),
            },
        }


def write_result(output_path: str, result) -> None:
    with open(output_path, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, indent=2)


def emit_json(event) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def run_server(runtime: FasterWhisperRuntime) -> int:
    emit_json({
        "type": "ready",
        "device": runtime.device,
        "computeType": runtime.compute_type,
        "batchSize": runtime.batch_size,
    })
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request = {}
        try:
            request = json.loads(line)
            if request.get("type") == "shutdown":
                return 0
            request_id = str(request["id"])
            audio_path = str(request["audio"])
            requested_language = request.get("language", "auto")
            language = None if requested_language == "auto" else requested_language
            result = runtime.transcribe(
                audio_path,
                language,
                lambda progress: emit_json({
                    "type": "progress",
                    "id": request_id,
                    "progress": progress,
                }),
            )
            emit_json({"type": "result", "id": request_id, "result": result})
        except Exception as exc:
            emit_json({
                "type": "error",
                "id": str(request.get("id", "")),
                "message": str(exc),
            })
    return 0


def parse_args():
    parser = argparse.ArgumentParser(description="DeskScribe Faster-Whisper runner")
    parser.add_argument("--audio", default="")
    parser.add_argument("--output", default="")
    parser.add_argument("--model", required=True)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--device", default="cpu", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--model-dir", default="")
    parser.add_argument("--cpu-threads", type=int, default=0)
    parser.add_argument("--num-workers", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=0)
    parser.add_argument("--server", action="store_true")
    return parser.parse_args()


def main() -> int:
    configure_stdio()
    args = parse_args()
    model_name = resolve_model(args.model, args.model_dir or None)
    runtime = FasterWhisperRuntime(
        model_name,
        args.device,
        args.compute_type,
        args.cpu_threads,
        args.num_workers,
        args.batch_size,
        emit_json if args.server else None,
    )

    if args.server:
        return run_server(runtime)
    if not args.audio or not args.output:
        raise SystemExit("--audio and --output are required outside server mode")

    language = None if args.language == "auto" else args.language
    result = runtime.transcribe(
        args.audio,
        language,
        lambda progress: print(f"progress = {progress}%", flush=True),
    )
    write_result(args.output, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
