# DeskScribe

DeskScribe 是一款本地优先的 Windows 录音与离线语音转写工具。它支持麦克风和系统声音录制、音频文件导入、中文/英文识别，并可导出 TXT、SRT 和 JSON。

## 主要功能

- 使用 Whisper.cpp 或 Faster-Whisper 在本机转写，音频无需上传到云端。
- 在应用内按需下载和切换模型，优先使用 GitHub Releases，失败时回退到 Hugging Face，并支持断点续传与手动放置模型。
- 提供完整模式和精简模式，可录音后转写或直接导入音频。
- 通过 GitHub Releases 检查更新；下载和安装均由用户确认。
- 模型与应用分开存储，升级应用不会覆盖已安装模型。

## 数据目录

Windows 用户数据位于：

```text
%APPDATA%\DeskScribe
```

模型位于 `%APPDATA%\DeskScribe\models`。默认卸载不会删除用户数据和模型。

## 项目结构

- `src/main`：窗口、IPC、录音转写、模型管理和自动更新。
- `src/preload`：向界面暴露受限的 Electron API。
- `src/renderer`：应用界面与交互。
- `resources`：运行时、图标、脚本和随安装包分发的文档。
- `.github/workflows/release.yml`：Windows 自动发布流程。

## 开发环境

- Windows x64
- Node.js 22
- npm
- Python 3.11（仅用于准备 Faster-Whisper 离线运行时）

首次开发前准备依赖和固定版本运行时：

```powershell
npm ci
./scripts/prepare-windows-runtime.ps1
npm run dev
```

项目没有必填环境变量。正式代码签名可在 GitHub 仓库中配置 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD`，不得将证书或密码提交到仓库。

## 验证与构建

```powershell
npm run check
npm run dist:win
```

安装包和自动更新文件生成在 `release` 目录。当前项目没有数据库，也不需要数据迁移。

## 发布与更新

Windows 安装包通过 GitHub Releases 分发。已安装的生产版本会在启动 12 秒后检查一次更新，之后由用户在设置中手动检查；发现新版本后，下载和安装都需要用户确认。

- [首次发布与后续发布流程](resources/docs/release-guide.md)
- [转写引擎、模型与计算设备说明](resources/docs/transcription-settings.txt)
