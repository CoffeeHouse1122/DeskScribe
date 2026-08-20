const assert = require("node:assert/strict");
const {
  advanceTranscriptionProgress,
  fasterWhisperSupportsLanguage
} = require("../dist/main/transcription-policy.js");

assert.equal(fasterWhisperSupportsLanguage("distil-large-v3", "en"), true);
assert.equal(fasterWhisperSupportsLanguage("distil-large-v3", "auto"), false);
assert.equal(fasterWhisperSupportsLanguage("distil-large-v3", "zh"), false);
assert.equal(fasterWhisperSupportsLanguage("large-v3-turbo", "auto"), true);
assert.equal(fasterWhisperSupportsLanguage("large-v3-turbo", "zh"), true);

assert.equal(advanceTranscriptionProgress(70, 56), 70);
assert.equal(advanceTranscriptionProgress(70, 82), 82);
assert.equal(advanceTranscriptionProgress(70, undefined), 70);
assert.equal(advanceTranscriptionProgress(70, 120), 100);

console.log("Transcription policy regression checks passed.");
