import type {
  AppPreferences,
  ExportFormat,
  RecordingAudioExportRequest,
  TranscriptDocument,
  TranscriptLanguage,
  TranscriptionProgressEvent,
  TranscriptionResult
} from "../shared/types";

type RecorderState = "idle" | "recording" | "paused" | "processing";

const defaultPreferences: AppPreferences = {
  theme: "system",
  closeBehavior: "tray",
  defaultLanguage: "auto",
  exportDirectory: "",
  whisperExecutablePath: "",
  ffmpegExecutablePath: "",
  modelPath: "",
  disableGpu: true
};

export function mountApp(root: HTMLDivElement) {
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand-block">
          <p class="eyebrow">DeskScribe</p>
          <h1>录音转写台</h1>
          <p class="subline">后台录音、导入音频、本地 Whisper 转写</p>
        </div>
        <div class="topbar-actions">
          <button id="settings-toggle" class="ghost-button icon-text-button" type="button">
            <i class="ri-settings-3-line" aria-hidden="true"></i>
            <span>设置</span>
          </button>
        </div>
      </header>

      <main class="workspace">
        <section class="column column-compact">
          <article class="panel panel-primary">
            <div class="panel-title">
              <div>
                <h2><i class="ri-mic-line" aria-hidden="true"></i><span>录音控制</span></h2>
              </div>
              <span id="recording-state" class="state-pill">待机</span>
            </div>

            <div class="meter-wrap">
              <div class="meter-rail">
                <div id="level-meter" class="meter-fill"></div>
              </div>
              <div id="elapsed" class="timer">00:00</div>
            </div>

            <div class="button-row">
              <button id="start-recording" class="primary-button icon-text-button" type="button"><i class="ri-record-circle-line" aria-hidden="true"></i><span>开始</span></button>
              <button id="pause-recording" class="ghost-button icon-text-button" type="button" disabled><i class="ri-pause-line" aria-hidden="true"></i><span>暂停</span></button>
              <button id="resume-recording" class="ghost-button icon-text-button" type="button" disabled><i class="ri-play-line" aria-hidden="true"></i><span>继续</span></button>
              <button id="stop-recording" class="ghost-button icon-text-button" type="button" disabled><i class="ri-stop-line" aria-hidden="true"></i><span>停止</span></button>
              <button id="export-recording" class="ghost-button icon-text-button" type="button" disabled><i class="ri-music-2-line" aria-hidden="true"></i><span>导出 MP3</span></button>
            </div>
          </article>

          <article class="panel">
            <div class="panel-title">
              <div>
                <h2><i class="ri-folder-music-line" aria-hidden="true"></i><span>导入音频</span></h2>
              </div>
            </div>
            <p id="selected-file" class="muted">未选择文件</p>
            <div class="button-row">
              <button id="choose-file" class="ghost-button icon-text-button" type="button"><i class="ri-folder-music-line" aria-hidden="true"></i><span>选择文件</span></button>
              <button id="transcribe-file" class="primary-button icon-text-button" type="button" disabled><i class="ri-magic-line" aria-hidden="true"></i><span>开始转写</span></button>
            </div>
          </article>

          <article class="panel">
            <div class="panel-title">
              <div>
                <h2><i class="ri-download-2-line" aria-hidden="true"></i><span>导出结果</span></h2>
              </div>
            </div>
            <div class="button-row compact-row">
              <button class="ghost-button export-button icon-text-button" data-format="txt" type="button" disabled><i class="ri-file-text-line" aria-hidden="true"></i><span>TXT</span></button>
              <button class="ghost-button export-button icon-text-button" data-format="srt" type="button" disabled><i class="ri-timer-line" aria-hidden="true"></i><span>SRT</span></button>
              <button class="ghost-button export-button icon-text-button" data-format="json" type="button" disabled><i class="ri-braces-line" aria-hidden="true"></i><span>JSON</span></button>
            </div>
            <p id="export-path" class="muted">导出后会自动定位文件位置。</p>
          </article>
        </section>

        <section class="column content-column">
          <article id="process-panel" class="panel process-panel" aria-live="polite">
            <div class="panel-title">
              <div>
                <h2><i class="ri-pulse-line" aria-hidden="true"></i><span>执行进程</span></h2>
              </div>
              <div class="process-actions">
                <span id="process-stage" class="state-pill">空闲</span>
                <button id="cancel-transcription" class="ghost-button icon-text-button danger-button" type="button" disabled><i class="ri-close-circle-line" aria-hidden="true"></i><span>取消</span></button>
              </div>
            </div>
            <div class="progress-track" aria-hidden="true">
              <div id="process-progress" class="progress-fill"></div>
            </div>
            <p id="process-message" class="status-text">选择音频或结束录音后，会在这里显示转换、识别和整理状态。</p>
            <div id="process-log" class="process-log" hidden></div>
          </article>

          <article class="panel transcript-panel">
            <div class="panel-title">
              <div>
                <h2><i class="ri-file-text-line" aria-hidden="true"></i><span>转写结果</span></h2>
              </div>
              <label class="language-field">
                <span>语言</span>
                <div id="language-select" class="custom-select" data-value="auto">
                  <button class="select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
                    <span class="select-label">自动检测</span>
                    <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
                  </button>
                  <div class="select-menu" role="listbox" hidden>
                    <button type="button" role="option" data-value="auto">自动检测</button>
                    <button type="button" role="option" data-value="zh">中文</button>
                    <button type="button" role="option" data-value="en">English</button>
                  </div>
                </div>
              </label>
            </div>

            <textarea
              id="transcript-text"
              class="transcript-text"
              readonly
              placeholder="录音或导入音频后，文本会显示在这里。"
            ></textarea>
          </article>
        </section>
      </main>

      <aside id="settings-panel" class="settings-panel" hidden>
        <div class="settings-card">
          <div class="settings-head">
            <div>
              <h2><i class="ri-settings-3-line" aria-hidden="true"></i><span>偏好设置</span></h2>
            </div>
            <button id="close-settings" class="ghost-button icon-text-button" type="button"><i class="ri-close-line" aria-hidden="true"></i><span>关闭</span></button>
          </div>

          <div class="settings-grid">
            <label class="field">
              <span>主题</span>
              <div id="theme-select" class="custom-select" data-value="system">
                <button class="select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
                  <span class="select-label">跟随系统</span>
                  <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
                </button>
                <div class="select-menu" role="listbox" hidden>
                  <button type="button" role="option" data-value="system">跟随系统</button>
                  <button type="button" role="option" data-value="light">浅色</button>
                  <button type="button" role="option" data-value="dark">深色</button>
                </div>
              </div>
            </label>

            <label class="field">
              <span>关闭按钮行为</span>
              <div id="close-behavior-select" class="custom-select" data-value="tray">
                <button class="select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
                  <span class="select-label">隐藏到托盘</span>
                  <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
                </button>
                <div class="select-menu" role="listbox" hidden>
                  <button type="button" role="option" data-value="tray">隐藏到托盘</button>
                  <button type="button" role="option" data-value="quit">直接退出</button>
                </div>
              </div>
            </label>

            <label class="field">
              <span>默认识别语言</span>
              <div id="default-language-select" class="custom-select" data-value="auto">
                <button class="select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
                  <span class="select-label">自动检测</span>
                  <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
                </button>
                <div class="select-menu" role="listbox" hidden>
                  <button type="button" role="option" data-value="auto">自动检测</button>
                  <button type="button" role="option" data-value="zh">中文</button>
                  <button type="button" role="option" data-value="en">English</button>
                </div>
              </div>
            </label>

            <label class="field checkbox-field">
              <input id="disable-gpu-checkbox" type="checkbox" checked />
              <span>CPU 稳定模式（关闭后尝试 GPU）</span>
            </label>
          </div>

          <div class="path-stack">
            <div class="path-field">
              <label class="field field-block">
                <span>转写程序</span>
                <input id="whisper-executable-input" type="text" readonly placeholder="默认使用内置 CPU 版；可选择 GPU 版 whisper-cli.exe" />
              </label>
              <button id="pick-whisper-executable" class="ghost-button icon-only-button" type="button" title="选择 whisper-cli" aria-label="选择 whisper-cli"><i class="ri-terminal-box-line" aria-hidden="true"></i></button>
            </div>

            <div class="path-field">
              <label class="field field-block">
                <span>转写模型</span>
                <input id="model-path-input" type="text" readonly placeholder="默认使用内置模型，可选择量化 large-v3 模型" />
              </label>
              <button id="pick-model-file" class="ghost-button icon-only-button" type="button" title="选择 Whisper 模型" aria-label="选择 Whisper 模型"><i class="ri-cpu-line" aria-hidden="true"></i></button>
            </div>

            <div class="path-field">
              <label class="field field-block">
                <span>导出目录</span>
                <input id="export-directory-input" type="text" readonly />
              </label>
              <button id="pick-export-directory" class="ghost-button icon-only-button" type="button" title="选择导出目录" aria-label="选择导出目录"><i class="ri-folder-open-line" aria-hidden="true"></i></button>
            </div>

          </div>
        </div>
      </aside>
    </div>
  `;

  const refs = {
    settingsPanel: root.querySelector<HTMLElement>("#settings-panel")!,
    settingsToggle: root.querySelector<HTMLButtonElement>("#settings-toggle")!,
    closeSettings: root.querySelector<HTMLButtonElement>("#close-settings")!,
    statePill: root.querySelector<HTMLSpanElement>("#recording-state")!,
    elapsed: root.querySelector<HTMLDivElement>("#elapsed")!,
    levelMeter: root.querySelector<HTMLDivElement>("#level-meter")!,
    processPanel: root.querySelector<HTMLElement>("#process-panel")!,
    processStage: root.querySelector<HTMLSpanElement>("#process-stage")!,
    cancelTranscription: root.querySelector<HTMLButtonElement>("#cancel-transcription")!,
    processProgress: root.querySelector<HTMLDivElement>("#process-progress")!,
    processMessage: root.querySelector<HTMLParagraphElement>("#process-message")!,
    processLog: root.querySelector<HTMLDivElement>("#process-log")!,
    startRecording: root.querySelector<HTMLButtonElement>("#start-recording")!,
    pauseRecording: root.querySelector<HTMLButtonElement>("#pause-recording")!,
    resumeRecording: root.querySelector<HTMLButtonElement>("#resume-recording")!,
    stopRecording: root.querySelector<HTMLButtonElement>("#stop-recording")!,
    exportRecording: root.querySelector<HTMLButtonElement>("#export-recording")!,
    chooseFile: root.querySelector<HTMLButtonElement>("#choose-file")!,
    transcribeFile: root.querySelector<HTMLButtonElement>("#transcribe-file")!,
    selectedFile: root.querySelector<HTMLParagraphElement>("#selected-file")!,
    transcriptText: root.querySelector<HTMLTextAreaElement>("#transcript-text")!,
    exportPath: root.querySelector<HTMLParagraphElement>("#export-path")!,
    exportButtons: Array.from(root.querySelectorAll<HTMLButtonElement>(".export-button")),
    languageSelect: root.querySelector<HTMLElement>("#language-select")!,
    themeSelect: root.querySelector<HTMLElement>("#theme-select")!,
    closeBehaviorSelect: root.querySelector<HTMLElement>("#close-behavior-select")!,
    defaultLanguageSelect: root.querySelector<HTMLElement>("#default-language-select")!,
    disableGpuCheckbox: root.querySelector<HTMLInputElement>("#disable-gpu-checkbox")!,
    whisperExecutableInput: root.querySelector<HTMLInputElement>("#whisper-executable-input")!,
    pickWhisperExecutable: root.querySelector<HTMLButtonElement>("#pick-whisper-executable")!,
    modelPathInput: root.querySelector<HTMLInputElement>("#model-path-input")!,
    pickModelFile: root.querySelector<HTMLButtonElement>("#pick-model-file")!,
    exportDirectoryInput: root.querySelector<HTMLInputElement>("#export-directory-input")!,
    pickExportDirectory: root.querySelector<HTMLButtonElement>("#pick-export-directory")!
  };

  let preferences = { ...defaultPreferences };
  let recorderState: RecorderState = "idle";
  let selectedFilePath = "";
  let currentTranscript: TranscriptDocument | null = null;
  let activeStream: MediaStream | null = null;
  let activeRecorder: MediaRecorder | null = null;
  let lastRecording: RecordingAudioExportRequest | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let pausedAt = 0;
  let pausedTotal = 0;
  let processStartedAt = 0;
  let processLogLines: string[] = [];
  let isTranscribing = false;

  const tickTimer = window.setInterval(() => {
    if (recorderState === "recording") {
      updateElapsed();
    }
  }, 250);

  const meterTimer = window.setInterval(() => {
    updateMeter();
  }, 120);

  function closeCustomSelects(except?: HTMLElement) {
    root.querySelectorAll<HTMLElement>(".custom-select.is-open").forEach((select) => {
      if (select === except) return;
      const button = select.querySelector<HTMLButtonElement>(".select-button");
      const menu = select.querySelector<HTMLElement>(".select-menu");
      select.classList.remove("is-open");
      button?.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
    });
  }

  function setCustomSelectValue(select: HTMLElement, value: string, silent = false) {
    const option = Array.from(select.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((item) => item.dataset.value === value);
    const label = select.querySelector<HTMLSpanElement>(".select-label");
    if (!option || !label) return;
    select.dataset.value = value;
    label.textContent = option.textContent || value;
    select.querySelectorAll<HTMLButtonElement>("[role='option']").forEach((item) => {
      item.setAttribute("aria-selected", item.dataset.value === value ? "true" : "false");
    });
    if (!silent) {
      select.dispatchEvent(new CustomEvent("custom-select-change"));
    }
  }

  function getCustomSelectValue<T extends string>(select: HTMLElement): T {
    return select.dataset.value as T;
  }

  function bindCustomSelect(select: HTMLElement) {
    const button = select.querySelector<HTMLButtonElement>(".select-button")!;
    const menu = select.querySelector<HTMLElement>(".select-menu")!;
    button.addEventListener("click", () => {
      const shouldOpen = !select.classList.contains("is-open");
      closeCustomSelects(select);
      select.classList.toggle("is-open", shouldOpen);
      button.setAttribute("aria-expanded", String(shouldOpen));
      menu.hidden = !shouldOpen;
    });
    menu.querySelectorAll<HTMLButtonElement>("[role='option']").forEach((option) => {
      option.addEventListener("click", () => {
        setCustomSelectValue(select, option.dataset.value || "");
        closeCustomSelects();
      });
    });
  }

  function onCustomSelectChange(element: HTMLElement, handler: () => Promise<void>) {
    element.addEventListener("custom-select-change", () => {
      void handler();
    });
  }

  function currentLanguage(): TranscriptLanguage {
    return getCustomSelectValue<TranscriptLanguage>(refs.languageSelect);
  }

  function updateElapsed(forceMs?: number) {
    const elapsedMs = forceMs ?? Math.max(0, Date.now() - startedAt - pausedTotal);
    const minutes = Math.floor(elapsedMs / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    refs.elapsed.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateMeter() {
    if (!analyser || recorderState === "idle" || recorderState === "processing") {
      refs.levelMeter.style.width = "4%";
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;
    refs.levelMeter.style.width = `${Math.min(100, Math.max(4, average / 2.2))}%`;
  }

  function applyTheme(theme: AppPreferences["theme"]) {
    document.documentElement.dataset.theme = theme;
  }

  function setStatus(text: string) {
    refs.processMessage.textContent = text;
    if (!isTranscribing) {
      refs.processPanel.dataset.stage = recorderState;
    }
  }

  function syncRecorderProcessState(next: RecorderState) {
    if (isTranscribing) return;
    refs.processStage.textContent =
      next === "recording" ? "录音中" :
      next === "paused" ? "已暂停" :
      next === "processing" ? "处理中" :
      "空闲";
    refs.processProgress.style.width = next === "recording" ? "18%" : next === "paused" ? "18%" : next === "processing" ? "36%" : "0%";
    refs.cancelTranscription.disabled = true;
  }

  function setRecorderState(next: RecorderState) {
    recorderState = next;
    refs.statePill.textContent =
      next === "recording" ? "录音中" :
      next === "paused" ? "已暂停" :
      next === "processing" ? "转写中" :
      "待机";
    refs.startRecording.disabled = next !== "idle";
    refs.pauseRecording.disabled = next !== "recording";
    refs.resumeRecording.disabled = next !== "paused";
    refs.stopRecording.disabled = next !== "recording" && next !== "paused";
    refs.exportRecording.disabled = next !== "idle" || !lastRecording;
    refs.chooseFile.disabled = next !== "idle";
    refs.transcribeFile.disabled = next !== "idle" || !selectedFilePath;
    syncRecorderProcessState(next);
  }

  function syncPreferencesToUi() {
    setCustomSelectValue(refs.themeSelect, preferences.theme, true);
    setCustomSelectValue(refs.closeBehaviorSelect, preferences.closeBehavior, true);
    setCustomSelectValue(refs.defaultLanguageSelect, preferences.defaultLanguage, true);
    refs.disableGpuCheckbox.checked = preferences.disableGpu;
    refs.whisperExecutableInput.value = preferences.whisperExecutablePath;
    refs.modelPathInput.value = preferences.modelPath;
    refs.exportDirectoryInput.value = preferences.exportDirectory;
    setCustomSelectValue(refs.languageSelect, preferences.defaultLanguage, true);
    applyTheme(preferences.theme);
  }

  async function persistPreferences() {
    preferences = await window.deskScribe.savePreferences(preferences);
    syncPreferencesToUi();
  }

  function renderTranscript(document: TranscriptDocument | null) {
    currentTranscript = document;
    refs.transcriptText.value = document?.text || "";
    refs.exportButtons.forEach((button) => {
      button.disabled = !document;
    });
  }

  function escapeHtml(text: string) {
    return text.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char] || char));
  }

  function normalizeErrorMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    const stripped = raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "");

    if (/No bundled Whisper model/i.test(stripped)) {
      return "未找到内置 Whisper 模型。请重新构建或安装包含 resources/models 的 DeskScribe。";
    }
    if (/Unable to locate bundled whisper\.cpp CLI/i.test(stripped)) {
      return "未找到内置 whisper-cli。请重新构建或安装包含 resources/bin/Release 的 DeskScribe。";
    }
    if (/Unable to locate bundled FFmpeg/i.test(stripped)) {
      return "未找到内置 FFmpeg。请重新构建或安装包含 resources/bin/Release 的 DeskScribe。";
    }
    if (/whisper-cli(?:\.exe)? exited with code 3221226505/i.test(stripped)) {
      return "whisper-cli 运行时崩溃。建议在设置中选择量化 large-v3 模型（Q8/Q5）或更小模型，再重试导入音频。";
    }
    if (/Transcription cancelled by user/i.test(stripped)) {
      return "已取消转写。";
    }

    return stripped;
  }

  function formatDuration(timeMs: number) {
    const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function resetProcessView(message = "等待新的转写任务。") {
    processStartedAt = 0;
    processLogLines = [];
    refs.processStage.textContent = "空闲";
    refs.processProgress.style.width = "0%";
    refs.processMessage.textContent = message;
    refs.processLog.hidden = true;
    refs.processLog.innerHTML = "";
    refs.cancelTranscription.disabled = true;
  }

  function applyTranscriptionProgress(progress: TranscriptionProgressEvent) {
    if (!processStartedAt && progress.stage !== "completed" && progress.stage !== "failed") {
      processStartedAt = Date.now();
    }
    const stageLabel =
      progress.stage === "queued" ? "准备" :
      progress.stage === "normalizing" ? "转换" :
      progress.stage === "transcribing" ? "识别" :
      progress.stage === "finalizing" ? "整理" :
      progress.stage === "completed" ? "完成" :
      progress.stage === "cancelled" ? "已取消" :
      "失败";
    const elapsedMs = progress.elapsedMs ?? (processStartedAt ? Date.now() - processStartedAt : 0);
    const percent = typeof progress.progress === "number"
      ? progress.progress
      : progress.stage === "transcribing"
        ? 68
        : progress.stage === "finalizing"
          ? 92
          : 0;

    refs.processStage.textContent = stageLabel;
    refs.processProgress.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    refs.processMessage.textContent = `${progress.message}${elapsedMs ? ` · ${formatDuration(elapsedMs)}` : ""}`;
    refs.processPanel.dataset.stage = progress.stage;
    refs.cancelTranscription.disabled = progress.stage === "completed" || progress.stage === "failed" || progress.stage === "cancelled" || !isTranscribing;

    if (progress.detail) {
      processLogLines = [progress.detail, ...processLogLines].slice(0, 80);
      refs.processLog.hidden = false;
      refs.processLog.innerHTML = processLogLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    }
  }

  async function processResult(task: Promise<TranscriptionResult>) {
    isTranscribing = true;
    setRecorderState("processing");
    applyTranscriptionProgress({ stage: "queued", message: "任务已提交", progress: 5 });
    refs.cancelTranscription.disabled = false;
    try {
      const result = await task;
      renderTranscript(result.document);
      applyTranscriptionProgress({ stage: "completed", message: "转写完成", progress: 100 });
      setStatus(`转写完成，检测语言：${result.document.engine.detectedLanguage || result.document.source.language}`);
      refs.exportPath.textContent = result.outputPath;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      applyTranscriptionProgress({ stage: message === "已取消转写。" ? "cancelled" : "failed", message, progress: 100 });
      setStatus(message);
    } finally {
      isTranscribing = false;
      refs.cancelTranscription.disabled = true;
      cleanupAudio();
      setRecorderState("idle");
      updateElapsed(0);
    }
  }

  async function requestMicrophoneStream() {
    const attempts: MediaStreamConstraints[] = [
      {
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
          channelCount: 1
        }
      },
      {
        audio: {
          channelCount: 1
        }
      },
      { audio: true }
    ];

    let lastError: unknown = new Error("未能打开麦克风。");

    for (const attempt of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(attempt);
      } catch (error) {
        lastError = error;
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const hasMic = devices.some((device) => device.kind === "audioinput");

    if (!hasMic) {
      throw new Error("未检测到可用麦克风设备。请连接麦克风或检查系统输入设备。");
    }

    const domError = lastError as DOMException | undefined;
    if (domError?.name === "NotAllowedError" || domError?.name === "PermissionDeniedError") {
      throw new Error("没有获得麦克风权限。请在系统中允许 DeskScribe 使用麦克风。");
    }
    if (domError?.name === "NotReadableError" || domError?.name === "TrackStartError") {
      throw new Error("麦克风当前可能正被其他应用占用，请关闭占用程序后重试。");
    }
    if (domError?.name === "NotFoundError" || domError?.name === "DevicesNotFoundError") {
      throw new Error("系统没有找到可用麦克风。请检查输入设备是否连接正常。");
    }

    throw new Error("无法初始化麦克风，请检查系统录音设备和权限设置。");
  }

  async function beginRecording() {
    const stream = await requestMicrophoneStream();
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    activeStream = stream;
    activeRecorder = new MediaRecorder(stream, { mimeType });
    lastRecording = null;
    refs.exportRecording.disabled = true;
    chunks = [];

    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    activeRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    activeRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const fileName = `recording-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      lastRecording = { bytes, mimeType, fileName };
      await processResult(
        window.deskScribe.transcribeRecording({
          bytes,
          mimeType,
          fileName,
          language: currentLanguage()
        })
      );
    };

    startedAt = Date.now();
    pausedAt = 0;
    pausedTotal = 0;
    updateElapsed(0);
    setRecorderState("recording");
    setStatus("录音进行中。切换到其他程序时，录音会继续保持。");
    activeRecorder.start(1000);
  }

  function pauseRecording() {
    if (!activeRecorder || recorderState !== "recording") return;
    activeRecorder.pause();
    pausedAt = Date.now();
    setRecorderState("paused");
    setStatus("录音已暂停。");
  }

  function resumeRecording() {
    if (!activeRecorder || recorderState !== "paused") return;
    activeRecorder.resume();
    if (pausedAt > 0) {
      pausedTotal += Date.now() - pausedAt;
      pausedAt = 0;
    }
    setRecorderState("recording");
    setStatus("录音已继续。");
  }

  function stopRecording() {
    if (!activeRecorder || (recorderState !== "recording" && recorderState !== "paused")) return;
    if (recorderState === "paused" && pausedAt > 0) {
      pausedTotal += Date.now() - pausedAt;
      pausedAt = 0;
    }
    setStatus("正在整理音频并提交转写。");
    setRecorderState("processing");
    activeRecorder.stop();
  }

  function cleanupAudio() {
    activeRecorder = null;
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
      activeStream = null;
    }
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }
    analyser = null;
    chunks = [];
  }

  async function pickAudioFile() {
    const filePath = await window.deskScribe.selectAudioFile();
    selectedFilePath = filePath || "";
    refs.selectedFile.textContent = selectedFilePath || "未选择文件";
    refs.transcribeFile.disabled = !selectedFilePath || recorderState !== "idle";
  }

  async function transcribeSelectedFile() {
    if (!selectedFilePath) return;
    await processResult(window.deskScribe.transcribeFile(selectedFilePath, currentLanguage()));
  }

  async function exportCurrentTranscript(format: ExportFormat) {
    if (!currentTranscript) return;
    const filePath = await window.deskScribe.exportTranscript(currentTranscript, format);
    if (filePath) {
      refs.exportPath.textContent = filePath;
      await window.deskScribe.revealPath(filePath);
      setStatus(`${format.toUpperCase()} 已导出。`);
    }
  }

  async function exportLastRecording() {
    if (!lastRecording) return;
    refs.exportRecording.disabled = true;
    setStatus("正在导出录音 MP3。");
    try {
      const filePath = await window.deskScribe.exportRecordingAudio(lastRecording);
      if (filePath) {
        await window.deskScribe.revealPath(filePath);
        setStatus("录音 MP3 已导出。");
      } else {
        setStatus("已取消导出录音。");
      }
    } catch (error) {
      setStatus(normalizeErrorMessage(error));
    } finally {
      refs.exportRecording.disabled = recorderState !== "idle" || !lastRecording;
    }
  }

  function openSettings(open: boolean) {
    refs.settingsPanel.hidden = !open;
    document.body.classList.toggle("settings-open", open);
  }

  async function bindPicker(
    picker: () => Promise<string | null>,
    assign: (value: string) => void
  ) {
    const next = await picker();
    if (!next) return;
    assign(next);
    await persistPreferences();
  }

  [refs.languageSelect, refs.themeSelect, refs.closeBehaviorSelect, refs.defaultLanguageSelect].forEach(bindCustomSelect);

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) return;
    if (!root.contains(event.target)) return;
    const select = event.target instanceof Element ? event.target.closest(".custom-select") : null;
    if (!select) {
      closeCustomSelects();
    }
  });

  refs.settingsToggle.addEventListener("click", () => openSettings(true));
  refs.closeSettings.addEventListener("click", () => openSettings(false));
  refs.settingsPanel.addEventListener("click", (event) => {
    if (event.target === refs.settingsPanel) {
      openSettings(false);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !refs.settingsPanel.hidden) {
      openSettings(false);
    }
    if (event.key === "Escape") {
      closeCustomSelects();
    }
  });

  refs.startRecording.addEventListener("click", () => {
    void beginRecording().catch((error) => setStatus(normalizeErrorMessage(error)));
  });
  refs.pauseRecording.addEventListener("click", pauseRecording);
  refs.resumeRecording.addEventListener("click", resumeRecording);
  refs.stopRecording.addEventListener("click", stopRecording);
  refs.cancelTranscription.addEventListener("click", () => {
    refs.cancelTranscription.disabled = true;
    setStatus("正在取消转写。");
    void window.deskScribe.cancelTranscription();
  });
  refs.exportRecording.addEventListener("click", () => {
    void exportLastRecording();
  });
  refs.chooseFile.addEventListener("click", () => {
    void pickAudioFile();
  });
  refs.transcribeFile.addEventListener("click", () => {
    void transcribeSelectedFile();
  });
  refs.exportButtons.forEach((button) => {
    button.addEventListener("click", () => {
      void exportCurrentTranscript(button.dataset.format as ExportFormat);
    });
  });

  onCustomSelectChange(refs.themeSelect, async () => {
    preferences.theme = getCustomSelectValue<AppPreferences["theme"]>(refs.themeSelect);
    await persistPreferences();
  });
  onCustomSelectChange(refs.closeBehaviorSelect, async () => {
    preferences.closeBehavior = getCustomSelectValue<AppPreferences["closeBehavior"]>(refs.closeBehaviorSelect);
    await persistPreferences();
  });
  onCustomSelectChange(refs.defaultLanguageSelect, async () => {
    preferences.defaultLanguage = getCustomSelectValue<TranscriptLanguage>(refs.defaultLanguageSelect);
    await persistPreferences();
  });
  refs.disableGpuCheckbox.addEventListener("change", async () => {
    preferences.disableGpu = refs.disableGpuCheckbox.checked;
    await persistPreferences();
  });

  refs.pickWhisperExecutable.addEventListener("click", () => {
    void bindPicker(window.deskScribe.selectWhisperExecutable, (value) => {
      preferences.whisperExecutablePath = value;
    });
  });

  refs.pickExportDirectory.addEventListener("click", () => {
    void bindPicker(window.deskScribe.selectExportDirectory, (value) => {
      preferences.exportDirectory = value;
    });
  });
  refs.pickModelFile.addEventListener("click", () => {
    void bindPicker(window.deskScribe.selectModelFile, (value) => {
      preferences.modelPath = value;
    });
  });
  void window.deskScribe.getPreferences().then((loaded) => {
    preferences = loaded;
    syncPreferencesToUi();
  }).catch(() => {
    syncPreferencesToUi();
  });

  const unsubscribeProgress = window.deskScribe.onTranscriptionProgress(applyTranscriptionProgress);

  renderTranscript(null);
  resetProcessView("选择音频或结束录音后，会在这里显示转换、识别和整理状态。");
  setRecorderState("idle");
  updateElapsed(0);

  window.addEventListener("beforeunload", () => {
    window.clearInterval(tickTimer);
    window.clearInterval(meterTimer);
    unsubscribeProgress();
    cleanupAudio();
  });
}
