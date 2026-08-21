const assert = require("node:assert/strict");
const {
  downloadWithModelFallback,
  githubModelAssetUrl,
  huggingFaceModelUrl,
  modelDownloadSources
} = require("../dist/main/model-download-policy.js");

assert.equal(
  githubModelAssetUrl("large-v3-turbo-model.bin"),
  "https://github.com/CoffeeHouse1122/DeskScribe/releases/download/models-v1/large-v3-turbo-model.bin"
);
assert.equal(
  huggingFaceModelUrl("owner/model", "revision", "model.bin"),
  "https://huggingface.co/owner/model/resolve/revision/model.bin?download=true"
);
assert.deepEqual(
  modelDownloadSources("distil-large-v3-config.json", "owner/model", "revision", "config.json"),
  [
    {
      label: "GitHub Releases",
      url: "https://github.com/CoffeeHouse1122/DeskScribe/releases/download/models-v1/distil-large-v3-config.json"
    },
    {
      label: "Hugging Face",
      url: "https://huggingface.co/owner/model/resolve/revision/config.json?download=true"
    }
  ]
);

async function runFallbackChecks() {
  const sources = modelDownloadSources("model.bin", "owner/model", "revision", "model.bin");
  const attempts = [];
  const fallbacks = [];
  const result = await downloadWithModelFallback(
    sources,
    async (source) => {
      attempts.push(source.label);
      if (source.label === "GitHub Releases") throw new Error("HTTP 404");
      return "downloaded";
    },
    (failed, fallback) => {
      fallbacks.push(`${failed.label}->${fallback.label}`);
    }
  );
  assert.equal(result, "downloaded");
  assert.deepEqual(attempts, ["GitHub Releases", "Hugging Face"]);
  assert.deepEqual(fallbacks, ["GitHub Releases->Hugging Face"]);

  const abortError = new Error("This operation was aborted");
  abortError.name = "AbortError";
  const abortAttempts = [];
  await assert.rejects(
    downloadWithModelFallback(
      sources,
      async (source) => {
        abortAttempts.push(source.label);
        throw abortError;
      },
      () => {
        throw new Error("取消下载时不应切换备用源");
      }
    ),
    abortError
  );
  assert.deepEqual(abortAttempts, ["GitHub Releases"]);
}

runFallbackChecks()
  .then(() => console.log("Model download policy regression checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
