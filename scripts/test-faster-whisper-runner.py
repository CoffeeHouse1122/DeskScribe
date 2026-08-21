import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace


class FakeTranscriber:
    def __init__(self) -> None:
        self.options = {}

    def transcribe(self, _audio_path, **options):
        self.options = options
        return iter([
            SimpleNamespace(start=0.0, end=1.0, text="第一句"),
            SimpleNamespace(start=1.0, end=2.0, text="第二句"),
        ]), SimpleNamespace(language="zh")


runner_path = Path(__file__).parents[1] / "resources" / "scripts" / "faster-whisper-runner.py"
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("deskscribe_faster_whisper_runner", runner_path)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load Faster-Whisper runner.")

runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

transcriber = FakeTranscriber()
runtime = runner.FasterWhisperRuntime.__new__(runner.FasterWhisperRuntime)
runtime.pipeline = transcriber
runtime.model = object()
runtime.batch_size = 4

progress = []
segments, info = runtime.collect_segments("unused.wav", "zh", 2_000, progress.append)

assert transcriber.options["without_timestamps"] is False
assert transcriber.options["batch_size"] == 4
assert [segment["text"] for segment in segments] == ["第一句", "第二句"]
assert info.language == "zh"
assert progress == [50, 100]

print("Faster-Whisper segmentation regression checks passed.")
