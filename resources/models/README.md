Place local Whisper model files here for development or private builds.

The public installer includes `ggml-small.bin` so the Whisper.cpp engine works
out of the box. Users can still select a larger external `ggml` / `gguf` model
from DeskScribe settings when they want higher accuracy.

Bundled Whisper.cpp model:
- `ggml-small.bin`

Faster-Whisper uses the bundled CTranslate2 model at:
- `faster-whisper/distil-large-v3/model.bin`

Do not remove this directory from release builds; Faster-Whisper runs offline
and does not download models at runtime.

Recommended:
- `ggml-large-v3.bin`
- or a quantized `large-v3` variant for lower-memory devices
