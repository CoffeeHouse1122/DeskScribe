# DeskScribe 发布指南

项目使用 GitHub Actions 构建 Windows x64 安装包，并发布到 GitHub Releases。推送标签后无需手动创建 Release。

## 发布前提

- 发布提交已经合并到 `main` 并推送到 GitHub。
- 工作区没有未提交文件，`npm run check` 已通过。
- `package.json` 与 `package-lock.json` 中的版本一致。
- 标签必须是 `v<版本号>`，例如版本 `1.0.1` 对应标签 `v1.0.1`。
- GitHub Actions 已启用，并允许工作流写入仓库内容。

需要 Windows 代码签名时，在仓库 Secrets 中配置：

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

未配置签名不影响构建，但 Windows 可能显示未知发布者提示。

## 首次发布

以下示例发布 `v1.0.0`。

1. 确认版本；如果当前不是 `1.0.0`，执行：

   ```powershell
   npm version 1.0.0 --no-git-tag-version
   ```

2. 安装依赖并验证：

   ```powershell
   npm ci
   npm run check
   ```

3. 如果第 1 步修改了版本，提交版本文件；确认其他发布内容也已提交，然后推送 `main`：

   ```powershell
   git add -- package.json package-lock.json
   git commit -m "准备 v1.0.0 发布"
   git push origin main
   ```

   版本原本已经是 `1.0.0` 且工作区干净时，跳过 `git add` 和 `git commit`。

4. 为发布提交创建并推送标签：

   ```powershell
   git tag -a v1.0.0 -m "DeskScribe v1.0.0"
   git push origin v1.0.0
   ```

5. 在仓库 **Actions** 页面等待 `Release DeskScribe` 完成，再到 **Releases** 页面检查文件。

## 后续发布

先提交本次功能和修复，确认工作区干净。以下示例从 `1.0.0` 发布补丁版本 `1.0.1`：

```powershell
git switch main
git pull --ff-only origin main
npm ci
npm run check
npm version patch
git push origin main
git push origin v1.0.1
```

`npm version patch` 会同时更新版本、创建版本提交和本地标签。根据变更范围也可以使用：

- `npm version minor`：新增兼容功能，例如 `1.0.0` → `1.1.0`。
- `npm version major`：包含不兼容变化，例如 `1.0.0` → `2.0.0`。

每次只推送本次标签，避免使用 `git push --tags` 意外发布旧标签。

## 发布结果

工作流成功后，Release 应包含：

- `DeskScribe-Setup-<版本>-x64.exe`：完整安装包。
- `DeskScribe-Setup-<版本>-x64.exe.blockmap`：增量更新元数据。
- `latest.yml`：应用检查更新使用的清单。
- GitHub 自动生成的源码压缩包。

应用启动 12 秒后会自动检查一次，后续检查由用户手动触发；下载和安装均需用户确认。

## 常见问题

- **只有源码压缩包**：先查看 Actions；构建仍在运行或已经失败时，安装包尚未上传。
- **版本校验失败**：标签与 `package.json` 版本不一致。
- **无法创建 Release**：检查仓库 Actions 的 Workflow permissions 是否允许写入内容。
- **运行时下载失败**：重新运行失败任务；持续失败时检查 Python、GitHub 或 npm 下载源。
- **修改代码后需要重新发布**：提交修复并发布新的补丁版本，不覆盖已发布版本。
