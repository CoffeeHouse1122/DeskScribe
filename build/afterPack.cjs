const fs = require("node:fs/promises");
const path = require("node:path");

const DELETE_DIR_NAMES = new Set(["__pycache__", "tests", "test", ".pytest_cache", ".cache"]);
const DELETE_FILE_EXTENSIONS = new Set([".pyc", ".pyo"]);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pruneDirectory(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (DELETE_DIR_NAMES.has(entry.name)) {
        await fs.rm(entryPath, { recursive: true, force: true });
        return;
      }
      await pruneDirectory(entryPath);
      return;
    }

    if (entry.isFile() && DELETE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      await fs.rm(entryPath, { force: true });
    }
  }));
}

exports.default = async function afterPack(context) {
  const bundledResources = path.join(context.appOutDir, "resources", "resources");
  if (!(await exists(bundledResources))) {
    return;
  }

  await Promise.all([
    pruneDirectory(path.join(bundledResources, "python")),
    pruneDirectory(path.join(bundledResources, "models", "faster-whisper"))
  ]);
};
