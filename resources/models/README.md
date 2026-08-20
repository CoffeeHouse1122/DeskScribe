This directory is only for local development and legacy private builds.

Public installers do not bundle speech models. DeskScribe downloads managed
models on demand to Electron's `userData/models` directory, verifies them, and
keeps them independent from application updates.

Managed models:

- Faster-Whisper `large-v3-turbo`: default for Chinese, English, and mixed audio.
- Faster-Whisper `distil-large-v3`: English-only low-latency alternative.
- Whisper.cpp `ggml-small.bin`: lightweight multilingual alternative.
- Whisper.cpp `ggml-large-v3-q5_0.bin`: higher-accuracy quantized alternative.

Users can also select an external `.bin` or `.gguf` file without copying it into
the managed model directory.
