# DeskScribe

DeskScribe 是一个本地优先的 Electron 录音与离线语音转写工具，支持麦克风、系统声音、音频文件导入、Whisper.cpp 和 Faster-Whisper。

## 架构

- `src/main`：窗口生命周期、IPC、模型管理、自动更新和本地转写能力。
- `src/preload`：通过 `contextBridge` 暴露最小业务 API。
- `src/renderer`：录音、转写、设置、模型库和更新界面。
- `resources/python`：Faster-Whisper 离线运行时，不提交 Git。
- `resources/bin/Release`：Whisper.cpp 与 FFmpeg 运行时，不提交 Git。
- 模型不进入安装包，按需下载到 Electron `userData/models`。

## 环境要求

- Node.js 22
- npm
- Windows x64 是当前自动发布目标
- 本地打包需要准备 `resources/python` 和 `resources/bin/Release/whisper-cli.exe`

在干净的 Windows 环境中可以运行以下脚本准备固定版本的 Python 3.11、Faster-Whisper 1.2.1 和 Whisper.cpp 1.9.1：

```powershell
./scripts/prepare-windows-runtime.ps1
```

## 开发与验证

```powershell
npm install
npm run dev
npm run typecheck
npm run check
```

打包命令：

```powershell
npm run pack
npm run dist
npm run dist:win
```

## 模型管理

应用提供四种定位明确的托管模型：

- `large-v3-turbo`：默认推荐，适合中文、英文和中英混合原文转写。
- `distil-large-v3`：英语专项的低延迟模型。
- `ggml-small.bin`：Whisper.cpp 轻量多语言模型。
- `ggml-large-v3-q5_0.bin`：Whisper.cpp 高精度量化多语言模型。

模型从固定的 Hugging Face 上游提交下载，主权重经过 SHA-256 校验。下载中的 `.part` 文件可以继续断点下载。应用更新不会覆盖模型；NSIS 默认卸载也会保留用户数据。

Windows 默认目录：

```text
%APPDATA%\DeskScribe\models
```

设置中的“外部 Whisper.cpp 模型”仍可直接选择用户已有的 `.bin` 或 `.gguf` 文件。

## GitHub Releases 自动更新

`electron-updater` 在已安装的生产包启动 12 秒后检查一次 GitHub Releases，后续检查由用户在设置页手动触发。发现新版本后，下载和安装均需要用户分别点击确认，关闭应用不会自动安装更新。

发布前先更新 `package.json` 版本，然后提交并推送匹配的标签：

```powershell
npm version patch
git push origin main
git push origin --tags
```

`.github/workflows/release.yml` 会验证标签与版本一致，准备离线运行时，构建 NSIS 安装包并上传以下更新文件：

- Windows 安装程序 `.exe`
- 差分下载元数据 `.blockmap`
- 更新清单 `latest.yml`

Windows 正式签名可配置仓库 Secrets：

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

不要把证书、密码或 GitHub Token 写入源码。macOS 自动更新需要在 macOS Runner 上签名并公证，目前不在自动发布工作流内。
