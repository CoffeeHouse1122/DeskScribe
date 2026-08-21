export interface ModelDownloadSource {
  label: "GitHub Releases" | "Hugging Face";
  url: string;
}

const GITHUB_MODEL_RELEASE_BASE = "https://github.com/CoffeeHouse1122/DeskScribe/releases/download/models-v1";

export function githubModelAssetUrl(assetName: string) {
  return `${GITHUB_MODEL_RELEASE_BASE}/${encodeURIComponent(assetName)}`;
}

export function huggingFaceModelUrl(repository: string, revision: string, fileName: string) {
  return `https://huggingface.co/${repository}/resolve/${revision}/${encodeURIComponent(fileName)}?download=true`;
}

export function modelDownloadSources(
  githubAssetName: string,
  huggingFaceRepository: string,
  huggingFaceRevision: string,
  fileName: string
): readonly ModelDownloadSource[] {
  return [
    {
      label: "GitHub Releases",
      url: githubModelAssetUrl(githubAssetName)
    },
    {
      label: "Hugging Face",
      url: huggingFaceModelUrl(huggingFaceRepository, huggingFaceRevision, fileName)
    }
  ];
}

export function isModelDownloadAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

export async function downloadWithModelFallback<T>(
  sources: readonly ModelDownloadSource[],
  attempt: (source: ModelDownloadSource) => Promise<T>,
  onFallback: (
    failedSource: ModelDownloadSource,
    fallbackSource: ModelDownloadSource,
    error: unknown
  ) => void | Promise<void>
) {
  let lastError: unknown;
  for (const [index, source] of sources.entries()) {
    try {
      return await attempt(source);
    } catch (error) {
      if (isModelDownloadAbortError(error)) throw error;
      lastError = error;
      const fallback = sources[index + 1];
      if (!fallback) break;
      await onFallback(source, fallback, error);
    }
  }
  throw lastError ?? new Error("没有可用的模型下载源。");
}
