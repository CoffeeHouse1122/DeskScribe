import type {
  AppPreferences,
  AppUpdateState,
  ExportFormat,
  ManagedModelId,
  ManagedModelInfo,
  ModelDownloadProgress,
  RecordingAudioExportRequest,
  TranscriptDocument,
  TranscriptLanguage,
  TranscriptSegment,
  TranscriptionProgressEvent,
  TranscriptionResult,
  WindowMode
} from "../shared/types";

type RecorderState = "idle" | "recording" | "paused" | "processing";
type RecordingAudioSource = "microphone" | "system" | "microphone-system";

const LIVE_TRANSCRIPTION_INTERVAL_MS = 8000;
const LIVE_TRANSCRIPTION_MIN_SECONDS = 3;
const LIVE_TRANSCRIPTION_OVERLAP_SECONDS = 2;
const LIVE_PCM_SAMPLE_RATE = 16000;
const WINDOW_MODE_STORAGE_KEY = "deskscribe.window-mode";

const defaultPreferences: AppPreferences = {
  theme: "system",
  closeBehavior: "tray",
  defaultLanguage: "auto",
  exportDirectory: "",
  ffmpegExecutablePath: "",
  disableGpu: true,
  transcriptionEngine: "faster-whisper",
  whisperCppModel: "ggml-small",
  fasterWhisperModel: "large-v3-turbo",
  whisperThreads: 4
};

export function mountApp(root: HTMLDivElement) {
  root.innerHTML = `
    <div class="shell" data-window-mode="compact">
      <div class="window-titlebar">
        <div class="window-brand" aria-label="录音转写台">
          <span class="window-app-icon"><i class="ri-mic-ai-line" aria-hidden="true"></i></span>
          <span>录音转写台</span>
        </div>
        <div class="window-controls">
          <button id="settings-toggle" class="titlebar-button" type="button" title="设置" aria-label="设置"><i class="ri-settings-3-line" aria-hidden="true"></i></button>
          <button id="mode-toggle" class="titlebar-button" type="button" title="切换到完整模式" aria-label="切换到完整模式"><i class="ri-fullscreen-line" aria-hidden="true"></i></button>
          <button id="refresh-window" class="titlebar-button" type="button" title="刷新" aria-label="刷新"><i class="ri-refresh-line" aria-hidden="true"></i></button>
          <button id="pin-window" class="titlebar-button" type="button" title="置顶窗口" aria-label="置顶窗口" aria-pressed="false"><i class="ri-pushpin-line" aria-hidden="true"></i></button>
          <button id="minimize-window" class="titlebar-button" type="button" title="最小化" aria-label="最小化"><i class="ri-subtract-line" aria-hidden="true"></i></button>
          <button id="maximize-window" class="titlebar-button" type="button" title="最大化" aria-label="最大化"><i class="ri-checkbox-blank-line" aria-hidden="true"></i></button>
          <button id="close-window" class="titlebar-button titlebar-close" type="button" title="关闭" aria-label="关闭"><i class="ri-close-line" aria-hidden="true"></i></button>
        </div>
      </div>

      <main class="workspace">
        <section class="column column-compact">
          <article class="panel panel-primary recording-panel">
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

            <div class="record-options">
              <label class="field">
                <span>录制来源</span>
                <div id="recording-source-select" class="custom-select" data-value="microphone">
                  <button class="select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
                    <span class="select-label">仅麦克风</span>
                    <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
                  </button>
                  <div class="select-menu" role="listbox" hidden>
                    <button type="button" role="option" data-value="microphone">仅麦克风</button>
                    <button type="button" role="option" data-value="system">仅系统声音</button>
                    <button type="button" role="option" data-value="microphone-system">麦克风 + 系统声音</button>
                  </div>
                </div>
              </label>

              <label class="toggle-field">
                <input id="live-transcription-checkbox" type="checkbox" />
                <span>边录边转写预览</span>
              </label>
            </div>

            <div class="recording-button-stack">
              <div class="button-row record-transport-row">
                <button id="start-recording" class="primary-button icon-text-button" type="button"><i class="ri-record-circle-line" aria-hidden="true"></i><span>开始</span></button>
                <button id="pause-recording" class="ghost-button icon-text-button" type="button" disabled><i class="ri-pause-line" aria-hidden="true"></i><span>暂停</span></button>
                <button id="resume-recording" class="ghost-button icon-text-button" type="button" disabled><i class="ri-play-line" aria-hidden="true"></i><span>继续</span></button>
                <button id="stop-recording" class="ghost-button icon-text-button" type="button" disabled><i class="ri-stop-line" aria-hidden="true"></i><span>停止</span></button>
              </div>
              <div class="button-row record-output-row">
                <button id="transcribe-recording" class="primary-button icon-text-button" type="button" disabled><i class="ri-magic-line" aria-hidden="true"></i><span>开始转写</span></button>
                <button id="export-recording" class="ghost-button icon-text-button" type="button" disabled><i class="ri-music-2-line" aria-hidden="true"></i><span>导出 MP3</span></button>
              </div>
            </div>
          </article>

          <article class="panel import-panel">
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

          <article class="panel export-panel">
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
            <button id="close-settings" class="ghost-button icon-only-button" type="button" title="关闭偏好设置" aria-label="关闭偏好设置"><i class="ri-close-line" aria-hidden="true"></i></button>
          </div>

          <div class="settings-content">
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

            <label class="field">
              <span>转写引擎</span>
              <div id="transcription-engine-select" class="custom-select" data-value="faster-whisper">
                <button class="select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
                  <span class="select-label">Faster-Whisper 加速</span>
                  <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
                </button>
                <div class="select-menu" role="listbox" hidden>
                  <button type="button" role="option" data-value="whisper-cpp">Whisper.cpp 稳定</button>
                  <button type="button" role="option" data-value="faster-whisper">Faster-Whisper 加速</button>
                </div>
              </div>
            </label>

            <label id="compute-mode-field" class="field checkbox-field">
              <input id="disable-gpu-checkbox" type="checkbox" checked />
              <span id="compute-mode-label">强制使用 CPU（取消勾选后优先 NVIDIA GPU）</span>
            </label>

            <label class="field">
              <span>转写线程数（0 自动）</span>
              <input id="whisper-threads-input" type="number" min="0" step="1" />
            </label>
          </div>

          <div class="path-stack">
            <div class="path-field">
              <label class="field field-block">
                <span>导出目录</span>
                <input id="export-directory-input" type="text" readonly />
              </label>
              <button id="pick-export-directory" class="ghost-button icon-only-button" type="button" title="选择导出目录" aria-label="选择导出目录"><i class="ri-folder-open-line" aria-hidden="true"></i></button>
            </div>

          </div>

          <section class="model-library" aria-labelledby="model-library-title">
            <div class="model-library-head">
              <div>
                <h3 id="model-library-title">本地模型库</h3>
                <p class="model-library-note">支持按需下载或手动复制，返回应用后自动识别；更新不影响模型。</p>
              </div>
              <button id="open-models-directory" class="ghost-button icon-only-button" type="button" title="打开模型目录" aria-label="打开模型目录"><i class="ri-folder-open-line" aria-hidden="true"></i></button>
            </div>
            <div id="model-list" class="model-list" aria-live="polite">
              <p class="muted">正在读取模型状态…</p>
            </div>
          </section>

          <section class="update-card" aria-labelledby="update-title">
            <div class="update-copy">
              <strong id="update-title">应用更新 <span id="current-version">—</span></strong>
              <span id="update-message">正在读取版本信息</span>
            </div>
            <div class="update-actions">
              <button id="check-update" class="ghost-button icon-text-button" type="button"><i class="ri-refresh-line" aria-hidden="true"></i><span>检查更新</span></button>
              <button id="download-update" class="primary-button icon-text-button" type="button" hidden><i class="ri-download-cloud-2-line" aria-hidden="true"></i><span>下载更新</span></button>
              <button id="install-update" class="primary-button icon-text-button" type="button" hidden><i class="ri-restart-line" aria-hidden="true"></i><span>安装更新</span></button>
            </div>
            <div id="update-progress-track" class="mini-progress" hidden><span id="update-progress"></span></div>
          </section>
          </div>
        </div>
      </aside>
    </div>
  `;

  const refs = {
    shell: root.querySelector<HTMLElement>(".shell")!,
    settingsPanel: root.querySelector<HTMLElement>("#settings-panel")!,
    settingsToggle: root.querySelector<HTMLButtonElement>("#settings-toggle")!,
    modeToggle: root.querySelector<HTMLButtonElement>("#mode-toggle")!,
    refreshWindow: root.querySelector<HTMLButtonElement>("#refresh-window")!,
    pinWindow: root.querySelector<HTMLButtonElement>("#pin-window")!,
    minimizeWindow: root.querySelector<HTMLButtonElement>("#minimize-window")!,
    maximizeWindow: root.querySelector<HTMLButtonElement>("#maximize-window")!,
    closeWindow: root.querySelector<HTMLButtonElement>("#close-window")!,
    closeSettings: root.querySelector<HTMLButtonElement>("#close-settings")!,
    currentVersion: root.querySelector<HTMLSpanElement>("#current-version")!,
    updateMessage: root.querySelector<HTMLSpanElement>("#update-message")!,
    checkUpdate: root.querySelector<HTMLButtonElement>("#check-update")!,
    downloadUpdate: root.querySelector<HTMLButtonElement>("#download-update")!,
    installUpdate: root.querySelector<HTMLButtonElement>("#install-update")!,
    updateProgressTrack: root.querySelector<HTMLElement>("#update-progress-track")!,
    updateProgress: root.querySelector<HTMLElement>("#update-progress")!,
    statePill: root.querySelector<HTMLSpanElement>("#recording-state")!,
    elapsed: root.querySelector<HTMLDivElement>("#elapsed")!,
    levelMeter: root.querySelector<HTMLDivElement>("#level-meter")!,
    processPanel: root.querySelector<HTMLElement>("#process-panel")!,
    processStage: root.querySelector<HTMLSpanElement>("#process-stage")!,
    cancelTranscription: root.querySelector<HTMLButtonElement>("#cancel-transcription")!,
    processProgress: root.querySelector<HTMLDivElement>("#process-progress")!,
    processMessage: root.querySelector<HTMLParagraphElement>("#process-message")!,
    processLog: root.querySelector<HTMLDivElement>("#process-log")!,
    recordingSourceSelect: root.querySelector<HTMLElement>("#recording-source-select")!,
    liveTranscriptionCheckbox: root.querySelector<HTMLInputElement>("#live-transcription-checkbox")!,
    startRecording: root.querySelector<HTMLButtonElement>("#start-recording")!,
    pauseRecording: root.querySelector<HTMLButtonElement>("#pause-recording")!,
    resumeRecording: root.querySelector<HTMLButtonElement>("#resume-recording")!,
    stopRecording: root.querySelector<HTMLButtonElement>("#stop-recording")!,
    transcribeRecording: root.querySelector<HTMLButtonElement>("#transcribe-recording")!,
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
    transcriptionEngineSelect: root.querySelector<HTMLElement>("#transcription-engine-select")!,
    computeModeField: root.querySelector<HTMLElement>("#compute-mode-field")!,
    computeModeLabel: root.querySelector<HTMLSpanElement>("#compute-mode-label")!,
    disableGpuCheckbox: root.querySelector<HTMLInputElement>("#disable-gpu-checkbox")!,
    whisperThreadsInput: root.querySelector<HTMLInputElement>("#whisper-threads-input")!,
    modelList: root.querySelector<HTMLElement>("#model-list")!,
    openModelsDirectory: root.querySelector<HTMLButtonElement>("#open-models-directory")!,
    exportDirectoryInput: root.querySelector<HTMLInputElement>("#export-directory-input")!,
    pickExportDirectory: root.querySelector<HTMLButtonElement>("#pick-export-directory")!
  };

  let preferences = { ...defaultPreferences };
  let managedModels: ManagedModelInfo[] = [];
  const modelDownloadProgress = new Map<ManagedModelId, ModelDownloadProgress>();
  let updateState: AppUpdateState = {
    phase: "idle",
    currentVersion: "",
    message: "尚未检查更新"
  };
  let windowMode: WindowMode = "compact";
  let recorderState: RecorderState = "idle";
  let selectedFilePath = "";
  let currentTranscript: TranscriptDocument | null = null;
  let activeStream: MediaStream | null = null;
  let microphoneStream: MediaStream | null = null;
  let systemAudioStream: MediaStream | null = null;
  let activeRecorder: MediaRecorder | null = null;
  let lastRecording: RecordingAudioExportRequest | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let audioGraphNodes: AudioNode[] = [];
  let livePcmProcessor: ScriptProcessorNode | null = null;
  let liveSilentOutput: GainNode | null = null;
  let chunks: Blob[] = [];
  let livePcmChunks: Int16Array[] = [];
  let livePcmBufferStartSample = 0;
  let livePcmSampleCount = 0;
  let liveProcessedSampleCount = 0;
  let liveLastFlushAt = 0;
  let liveTranscriptionBusy = false;
  let liveTranscriptionStopped = true;
  let liveTranscriptionPending = false;
  let isLiveTranscribing = false;
  let liveTranscriptSegments: TranscriptSegment[] = [];
  let liveSegmentIndex = 0;
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

  function currentRecordingSource(): RecordingAudioSource {
    return getCustomSelectValue<RecordingAudioSource>(refs.recordingSourceSelect);
  }

  function liveTranscriptionRequested() {
    return refs.liveTranscriptionCheckbox.checked;
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

  function applyWindowMode(mode: WindowMode) {
    windowMode = mode;
    window.sessionStorage.setItem(WINDOW_MODE_STORAGE_KEY, mode);
    refs.shell.dataset.windowMode = mode;
    document.documentElement.dataset.windowMode = mode;
    const isCompact = mode === "compact";
    refs.modeToggle.title = isCompact ? "切换到完整模式" : "切换到精简模式";
    refs.modeToggle.setAttribute("aria-label", refs.modeToggle.title);
    refs.modeToggle.querySelector("i")!.className = isCompact ? "ri-fullscreen-line" : "ri-fullscreen-exit-line";
    refs.maximizeWindow.classList.remove("is-maximized");
    refs.maximizeWindow.title = "最大化";
    refs.maximizeWindow.setAttribute("aria-label", "最大化");
    refs.maximizeWindow.querySelector("i")!.className = "ri-checkbox-blank-line";
  }

  function initialWindowMode(): WindowMode {
    const stored = window.sessionStorage.getItem(WINDOW_MODE_STORAGE_KEY);
    if (stored === "compact" || stored === "full") {
      return stored;
    }
    return window.innerWidth >= 700 ? "full" : "compact";
  }

  function syncMaximizeButton(maximized: boolean) {
    refs.maximizeWindow.classList.toggle("is-maximized", maximized);
    refs.maximizeWindow.title = maximized ? "还原" : "最大化";
    refs.maximizeWindow.setAttribute("aria-label", refs.maximizeWindow.title);
    refs.maximizeWindow.querySelector("i")!.className = maximized ? "ri-file-copy-line" : "ri-checkbox-blank-line";
  }

  function setStatus(text: string) {
    refs.processMessage.textContent = text;
    if (!isTranscribing && !isLiveTranscribing) {
      refs.processPanel.dataset.stage = recorderState;
    }
  }

  function setPathText(element: HTMLElement, filePath: string, emptyText: string) {
    element.textContent = filePath || emptyText;
    element.toggleAttribute("data-tail-path", Boolean(filePath));
    element.title = filePath;
  }

  function syncRecorderProcessState(next: RecorderState) {
    if (isTranscribing || isLiveTranscribing) return;
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
    refs.transcribeRecording.disabled = next !== "idle" || !lastRecording || liveTranscriptionBusy;
    refs.exportRecording.disabled = next !== "idle" || !lastRecording;
    refs.chooseFile.disabled = next !== "idle";
    refs.transcribeFile.disabled = next !== "idle" || !selectedFilePath;
    refs.recordingSourceSelect.querySelector<HTMLButtonElement>(".select-button")!.disabled = next !== "idle";
    refs.liveTranscriptionCheckbox.disabled = next !== "idle";
    refs.refreshWindow.disabled = next !== "idle" || isTranscribing || isLiveTranscribing;
    syncRecorderProcessState(next);
  }

  function selectedManagedModelId() {
    if (preferences.transcriptionEngine === "faster-whisper") {
      return preferences.fasterWhisperModel === "distil-large-v3"
        ? "faster-whisper-distil-large-v3"
        : "faster-whisper-large-v3-turbo";
    }
    return preferences.whisperCppModel === "ggml-large-v3-q5_0"
      ? "whisper-cpp-large-v3-q5_0"
      : "whisper-cpp-small";
  }

  function syncPreferencesToUi() {
    setCustomSelectValue(refs.themeSelect, preferences.theme, true);
    setCustomSelectValue(refs.closeBehaviorSelect, preferences.closeBehavior, true);
    setCustomSelectValue(refs.defaultLanguageSelect, preferences.defaultLanguage, true);
    setCustomSelectValue(refs.transcriptionEngineSelect, preferences.transcriptionEngine, true);
    const whisperCpuOnly = preferences.transcriptionEngine === "whisper-cpp";
    refs.computeModeField.classList.toggle("is-disabled", whisperCpuOnly);
    refs.computeModeLabel.textContent = whisperCpuOnly
      ? "Whisper.cpp 当前使用内置 CPU 运行时"
      : "强制使用 CPU（取消勾选后优先 NVIDIA GPU）";
    refs.disableGpuCheckbox.disabled = whisperCpuOnly;
    refs.disableGpuCheckbox.checked = whisperCpuOnly || preferences.disableGpu;
    refs.whisperThreadsInput.max = String(Math.max(1, navigator.hardwareConcurrency || 4));
    refs.whisperThreadsInput.value = String(Math.max(0, Math.min(preferences.whisperThreads || 0, Number(refs.whisperThreadsInput.max))));
    refs.exportDirectoryInput.value = preferences.exportDirectory;
    setCustomSelectValue(refs.languageSelect, preferences.defaultLanguage, true);
    applyTheme(preferences.theme);
    renderModelLibrary();
  }

  async function persistPreferences() {
    preferences = await window.deskScribe.savePreferences(preferences);
    syncPreferencesToUi();
  }

  function formatBytes(bytes: number) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    return `${Math.round(bytes / 1024 ** 2)} MB`;
  }

  function renderModelLibrary() {
    if (managedModels.length === 0) {
      refs.modelList.innerHTML = '<p class="muted">暂无可用模型信息。</p>';
      return;
    }
    const selectedId = selectedManagedModelId();
    refs.modelList.innerHTML = managedModels.map((model) => {
      const progress = modelDownloadProgress.get(model.id);
      const active = progress && (progress.phase === "downloading" || progress.phase === "verifying");
      const selected = model.id === selectedId;
      const action = active
        ? `<button class="ghost-button model-action" data-model-action="cancel" data-model-id="${model.id}" type="button">暂停</button>`
        : model.installed
          ? `<button class="${selected ? "ghost-button" : "primary-button"} model-action" data-model-action="use" data-model-id="${model.id}" type="button" ${selected ? "disabled" : ""}>${selected ? "当前使用" : "使用"}</button>`
          : `<button class="primary-button model-action" data-model-action="download" data-model-id="${model.id}" type="button"><i class="ri-download-cloud-2-line" aria-hidden="true"></i>下载</button>`;
      const progressMarkup = progress
        ? `<div class="model-progress ${progress.phase}"><div><span>${escapeHtml(progress.message)}</span><strong>${progress.percent.toFixed(1)}%</strong></div><div class="mini-progress"><span style="width:${progress.percent}%"></span></div></div>`
        : "";
      return `
        <article class="model-card" data-model-id="${model.id}">
          <div class="model-card-main">
            <div class="model-title-row">
              <strong>${escapeHtml(model.displayName)}</strong>
              <span class="model-badge engine">${model.engine === "faster-whisper" ? "Faster-Whisper" : "Whisper.cpp"}</span>
              ${model.recommended ? '<span class="model-badge recommended">默认推荐</span>' : ""}
              <span class="model-badge ${model.installed ? "installed" : ""}">${model.installed ? "已安装" : formatBytes(model.sizeBytes)}</span>
            </div>
            <p>${escapeHtml(model.description)}</p>
            <span class="model-meta">${escapeHtml(model.languageHint)} · ${formatBytes(model.sizeBytes)} · ${escapeHtml(model.hardwareHint)}</span>
          </div>
          <div class="model-card-actions">${action}</div>
          ${progressMarkup}
        </article>`;
    }).join("");
  }

  async function refreshManagedModels() {
    try {
      managedModels = await window.deskScribe.getManagedModels();
      renderModelLibrary();
    } catch (error) {
      refs.modelList.innerHTML = `<p class="model-error">${escapeHtml(normalizeErrorMessage(error))}</p>`;
    }
  }

  function renderUpdateState() {
    refs.currentVersion.textContent = updateState.currentVersion ? `v${updateState.currentVersion}` : "—";
    refs.updateMessage.textContent = updateState.message;
    refs.checkUpdate.hidden = updateState.phase === "available" || updateState.phase === "downloading" || updateState.phase === "downloaded";
    refs.checkUpdate.disabled = updateState.phase === "checking" || updateState.phase === "disabled";
    refs.downloadUpdate.hidden = updateState.phase !== "available";
    refs.installUpdate.hidden = updateState.phase !== "downloaded";
    const showProgress = updateState.phase === "downloading" || updateState.phase === "downloaded";
    refs.updateProgressTrack.hidden = !showProgress;
    refs.updateProgress.style.width = `${updateState.percent ?? 0}%`;
  }

  async function applyModelSelection(model: ManagedModelInfo) {
    preferences.transcriptionEngine = model.engine;
    if (model.engine === "faster-whisper") {
      preferences.fasterWhisperModel = model.modelName === "distil-large-v3" ? "distil-large-v3" : "large-v3-turbo";
    } else {
      preferences.whisperCppModel = model.modelName === "ggml-large-v3-q5_0" ? "ggml-large-v3-q5_0" : "ggml-small";
    }
    await persistPreferences();
    setStatus(`已切换到 ${model.displayName}。`);
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

    if (/MODEL_NOT_INSTALLED:faster-whisper-large-v3-turbo/i.test(stripped)) {
      return "尚未安装默认的 Large V3 Turbo 模型，请在设置的模型库中下载。";
    }
    if (/MODEL_NOT_INSTALLED:faster-whisper-distil-large-v3/i.test(stripped)) {
      return "尚未安装 Distil Large V3 模型，请在设置的模型库中下载。";
    }
    if (/MODEL_NOT_INSTALLED:whisper-cpp-large-v3-q5_0/i.test(stripped)) {
      return "尚未安装 Large V3 Q5_0 模型，请在设置的模型库中下载。";
    }
    if (/MODEL_NOT_INSTALLED:whisper-cpp-small/i.test(stripped)) {
      return "尚未安装 Whisper Small 模型，请在设置的模型库中下载。";
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
    refs.cancelTranscription.disabled = progress.stage === "completed" || progress.stage === "failed" || progress.stage === "cancelled" || (!isTranscribing && !isLiveTranscribing);

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
      setPathText(refs.exportPath, result.outputPath, "导出后会自动定位文件位置。");
    } catch (error) {
      const missingModel = /MODEL_NOT_INSTALLED:/i.test(error instanceof Error ? error.message : String(error));
      const message = normalizeErrorMessage(error);
      applyTranscriptionProgress({ stage: message === "已取消转写。" ? "cancelled" : "failed", message, progress: 100 });
      setStatus(message);
      if (missingModel) {
        openSettings(true);
      }
    } finally {
      isTranscribing = false;
      refs.cancelTranscription.disabled = true;
      cleanupAudio();
      setRecorderState("idle");
      updateElapsed(0);
    }
  }

  function recordingToTranscriptionRequest(recording: RecordingAudioExportRequest) {
    return {
      bytes: recording.bytes,
      mimeType: recording.mimeType,
      fileName: recording.fileName,
      language: currentLanguage()
    };
  }

  function resetLiveTranscription() {
    livePcmChunks = [];
    livePcmBufferStartSample = 0;
    livePcmSampleCount = 0;
    liveProcessedSampleCount = 0;
    liveLastFlushAt = Date.now();
    liveTranscriptionBusy = false;
    liveTranscriptionStopped = !liveTranscriptionRequested();
    liveTranscriptionPending = false;
    isLiveTranscribing = false;
    liveTranscriptSegments = [];
    liveSegmentIndex = 0;
  }

  function downsampleToInt16(input: Float32Array, sourceRate: number, targetRate: number) {
    if (sourceRate <= targetRate) {
      const direct = new Int16Array(input.length);
      for (let index = 0; index < input.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, input[index] || 0));
        direct[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return direct;
    }

    const ratio = sourceRate / targetRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Int16Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.min(input.length, Math.floor((index + 1) * ratio));
      let sum = 0;
      for (let cursor = start; cursor < end; cursor += 1) {
        sum += input[cursor] || 0;
      }
      const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  }

  function encodeLivePcmWav(startSample: number, endSample: number) {
    const safeStart = Math.max(livePcmBufferStartSample, Math.min(startSample, livePcmSampleCount));
    const safeEnd = Math.max(safeStart, Math.min(endSample, livePcmSampleCount));
    const sampleCount = safeEnd - safeStart;
    const dataBytes = sampleCount * 2;
    const bytes = new Uint8Array(44 + dataBytes);
    const view = new DataView(bytes.buffer);
    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };

    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, LIVE_PCM_SAMPLE_RATE, true);
    view.setUint32(28, LIVE_PCM_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    let chunkStart = livePcmBufferStartSample;
    for (const chunk of livePcmChunks) {
      const chunkEnd = chunkStart + chunk.length;
      const copyStart = Math.max(safeStart, chunkStart);
      const copyEnd = Math.min(safeEnd, chunkEnd);
      for (let index = copyStart - chunkStart; index < copyEnd - chunkStart; index += 1) {
        view.setInt16(offset, chunk[index] || 0, true);
        offset += 2;
      }
      chunkStart = chunkEnd;
      if (chunkStart >= safeEnd) break;
    }
    return bytes;
  }

  function trimLivePcmBefore(sample: number) {
    const target = Math.max(livePcmBufferStartSample, Math.min(sample, livePcmSampleCount));
    let remaining = target - livePcmBufferStartSample;
    while (remaining > 0 && livePcmChunks.length > 0) {
      const first = livePcmChunks[0];
      if (remaining >= first.length) {
        remaining -= first.length;
        livePcmBufferStartSample += first.length;
        livePcmChunks.shift();
      } else {
        livePcmChunks[0] = first.slice(remaining);
        livePcmBufferStartSample += remaining;
        remaining = 0;
      }
    }
  }

  function startLivePcmCapture(mixer: AudioNode) {
    if (!audioContext || !liveTranscriptionRequested()) return;
    livePcmProcessor = audioContext.createScriptProcessor(4096, 2, 2);
    liveSilentOutput = audioContext.createGain();
    liveSilentOutput.gain.value = 0;
    livePcmProcessor.onaudioprocess = (event) => {
      if (liveTranscriptionStopped) return;
      const inputBuffer = event.inputBuffer;
      const channelCount = Math.max(1, inputBuffer.numberOfChannels);
      const mono = new Float32Array(inputBuffer.length);
      for (let channel = 0; channel < channelCount; channel += 1) {
        const channelData = inputBuffer.getChannelData(channel);
        for (let index = 0; index < channelData.length; index += 1) {
          mono[index] += channelData[index] / channelCount;
        }
      }
      const pcm = downsampleToInt16(mono, audioContext!.sampleRate, LIVE_PCM_SAMPLE_RATE);
      livePcmChunks.push(pcm);
      livePcmSampleCount += pcm.length;
    };
    mixer.connect(livePcmProcessor);
    livePcmProcessor.connect(liveSilentOutput);
    liveSilentOutput.connect(audioContext.destination);
    audioGraphNodes.push(livePcmProcessor, liveSilentOutput);
  }

  function renderLiveTranscript(document: TranscriptDocument, snapshotStartSample: number) {
    const snapshotStartMs = Math.round(snapshotStartSample * 1000 / LIVE_PCM_SAMPLE_RATE);
    const incoming = document.segments.map((segment) => ({
      ...segment,
      startMs: snapshotStartMs + segment.startMs,
      endMs: snapshotStartMs + segment.endMs
    }));
    if (incoming.length === 0 && document.text.trim()) {
      incoming.push({
        id: 1,
        startMs: snapshotStartMs,
        endMs: snapshotStartMs,
        text: document.text.trim()
      });
    }
    if (incoming.length === 0) return;

    const retained = liveTranscriptSegments.filter((segment) => segment.endMs <= snapshotStartMs);
    liveTranscriptSegments = [...retained, ...incoming]
      .sort((left, right) => left.startMs - right.startMs)
      .filter((segment, index, segments) => {
        const previous = segments[index - 1];
        return !previous || previous.text !== segment.text || previous.startMs !== segment.startMs;
      })
      .map((segment, index) => ({ ...segment, id: index + 1 }));
    refs.transcriptText.value = liveTranscriptSegments.map((segment) => segment.text).join("\n");
    refs.transcriptText.scrollTop = refs.transcriptText.scrollHeight;
  }

  async function transcribeLiveSnapshot() {
    if (livePcmSampleCount <= liveProcessedSampleCount || liveTranscriptionStopped) return;
    liveTranscriptionBusy = true;
    isLiveTranscribing = true;
    setRecorderState(recorderState);
    applyTranscriptionProgress({ stage: "queued", message: "实时转写预览已提交", progress: 5 });
    refs.cancelTranscription.disabled = false;
    const snapshotEndSample = livePcmSampleCount;
    const overlapSamples = LIVE_TRANSCRIPTION_OVERLAP_SECONDS * LIVE_PCM_SAMPLE_RATE;
    const snapshotStartSample = liveProcessedSampleCount > 0
      ? Math.max(livePcmBufferStartSample, liveProcessedSampleCount - overlapSamples)
      : livePcmBufferStartSample;
    try {
      const bytes = encodeLivePcmWav(snapshotStartSample, snapshotEndSample);
      if (bytes.byteLength < 4096) return;
      const fileName = `live-recording-${String(++liveSegmentIndex).padStart(3, "0")}`;
      const result = await window.deskScribe.transcribeRecording({
        bytes,
        mimeType: "audio/wav",
        fileName,
        language: currentLanguage()
      });
      renderLiveTranscript(result.document, snapshotStartSample);
      liveProcessedSampleCount = Math.max(liveProcessedSampleCount, snapshotEndSample);
      trimLivePcmBefore(Math.max(0, liveProcessedSampleCount - overlapSamples));
      applyTranscriptionProgress({ stage: "completed", message: "实时转写预览已更新", progress: 100 });
      setStatus(result.document.text.trim()
        ? "实时转写预览已更新。停止录音后仍可点击“开始转写”生成完整结果。"
        : "实时转写暂未识别到文本，会继续等待后续音频。");
    } catch (error) {
      const message = normalizeErrorMessage(error);
      const cancelled = message === "已取消转写。";
      liveTranscriptionStopped = true;
      liveTranscriptionPending = false;
      refs.liveTranscriptionCheckbox.checked = false;
      applyTranscriptionProgress({
        stage: cancelled ? "cancelled" : "failed",
        message: cancelled ? "实时转写预览已取消，录音仍在继续。" : `实时转写预览失败：${message}`,
        progress: 100
      });
      setStatus(cancelled ? "实时转写预览已取消，录音仍在继续。" : `实时转写预览失败：${message}`);
    } finally {
      liveTranscriptionBusy = false;
      isLiveTranscribing = false;
      refs.cancelTranscription.disabled = true;
      setRecorderState(recorderState);
      if (liveTranscriptionPending && !liveTranscriptionStopped) {
        liveTranscriptionPending = false;
        maybeFlushLiveTranscription(true);
      }
    }
  }

  function maybeFlushLiveTranscription(force = false) {
    if (!liveTranscriptionRequested() || liveTranscriptionStopped) return;
    const elapsed = Date.now() - liveLastFlushAt;
    if (!force && elapsed < LIVE_TRANSCRIPTION_INTERVAL_MS) return;
    if (liveTranscriptionBusy) {
      liveTranscriptionPending = true;
      return;
    }
    const pendingSamples = livePcmSampleCount - liveProcessedSampleCount;
    if (pendingSamples <= 0) return;
    if (!force && pendingSamples < LIVE_PCM_SAMPLE_RATE * LIVE_TRANSCRIPTION_MIN_SECONDS) return;
    liveLastFlushAt = Date.now();
    void transcribeLiveSnapshot();
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

  async function requestSystemAudioStream() {
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error("当前运行环境不支持系统声音录制。");
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("未获取到系统声音。请选择可共享音频的屏幕/窗口，并确认已启用系统音频。");
    }

    return stream;
  }

  async function createRecorderStream(sourceMode: RecordingAudioSource) {
    microphoneStream = null;
    systemAudioStream = null;

    if (sourceMode === "microphone" || sourceMode === "microphone-system") {
      microphoneStream = await requestMicrophoneStream();
    }

    if (sourceMode === "system" || sourceMode === "microphone-system") {
      try {
        systemAudioStream = await requestSystemAudioStream();
      } catch (error) {
        if (microphoneStream) {
          microphoneStream.getTracks().forEach((track) => track.stop());
          microphoneStream = null;
        }
        throw error;
      }
    }

    audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    const destination = audioContext.createMediaStreamDestination();
    const mixer = audioContext.createGain();
    const connectInput = (stream: MediaStream) => {
      const source = audioContext!.createMediaStreamSource(stream);
      source.connect(mixer);
      audioGraphNodes.push(source);
    };

    if (microphoneStream) {
      connectInput(microphoneStream);
    }
    if (systemAudioStream) {
      connectInput(systemAudioStream);
    }

    if (destination.stream.getAudioTracks().length === 0) {
      throw new Error("未获取到可录制的音频来源。");
    }

    mixer.connect(destination);
    mixer.connect(analyser);
    audioGraphNodes.push(mixer, destination, analyser);
    startLivePcmCapture(mixer);

    return destination.stream;
  }

  async function beginRecording() {
    const sourceMode = currentRecordingSource();
    chunks = [];
    resetLiveTranscription();
    const stream = await createRecorderStream(sourceMode);
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    activeStream = stream;
    activeRecorder = new MediaRecorder(stream, { mimeType });
    lastRecording = null;
    refs.exportRecording.disabled = true;
    refs.transcribeRecording.disabled = true;
    if (liveTranscriptionRequested()) {
      renderTranscript(null);
      refs.transcriptText.placeholder = "正在边录边转写，实时预览会分段追加在这里。";
    }

    activeRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
        if (liveTranscriptionRequested() && !liveTranscriptionStopped) {
          maybeFlushLiveTranscription();
        }
      }
    };

    activeRecorder.onstop = async () => {
      liveTranscriptionStopped = true;
      const blob = new Blob(chunks, { type: mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const fileName = `recording-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      lastRecording = { bytes, mimeType, fileName };
      cleanupAudio();
      setRecorderState("idle");
      refs.transcriptText.placeholder = "录音或导入音频后，文本会显示在这里。";
      setStatus(liveTranscriptionRequested()
        ? "录音已保存，实时预览已停止。可以导出 MP3，或点击“开始转写”生成完整转写结果。"
        : "录音已保存。可以导出 MP3，或点击“开始转写”进行识别。");
    };

    startedAt = Date.now();
    pausedAt = 0;
    pausedTotal = 0;
    updateElapsed(0);
    setRecorderState("recording");
    setStatus(sourceMode === "microphone-system"
      ? "正在录制麦克风和系统声音。请保持系统音频共享窗口处于有效状态。"
      : sourceMode === "system"
        ? "正在录制系统声音。请保持系统音频共享窗口处于有效状态。"
        : "录音进行中。切换到其他程序时，录音会继续保持。");
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
    setStatus("正在整理录音文件。");
    setRecorderState("processing");
    if (liveTranscriptionRequested()) {
      maybeFlushLiveTranscription(true);
    }
    activeRecorder.stop();
  }

  function cleanupAudio() {
    activeRecorder = null;
    if (livePcmProcessor) {
      livePcmProcessor.onaudioprocess = null;
      livePcmProcessor = null;
    }
    for (const node of audioGraphNodes) {
      try {
        node.disconnect();
      } catch {
        // Some nodes may already be disconnected when a capture permission flow fails.
      }
    }
    audioGraphNodes = [];
    liveSilentOutput = null;
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
      activeStream = null;
    }
    if (microphoneStream) {
      microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
    }
    if (systemAudioStream) {
      systemAudioStream.getTracks().forEach((track) => track.stop());
      systemAudioStream = null;
    }
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }
    analyser = null;
    chunks = [];
    livePcmChunks = [];
    livePcmSampleCount = 0;
  }

  async function pickAudioFile() {
    const filePath = await window.deskScribe.selectAudioFile();
    selectedFilePath = filePath || "";
    setPathText(refs.selectedFile, selectedFilePath, "未选择文件");
    refs.transcribeFile.disabled = !selectedFilePath || recorderState !== "idle";
  }

  async function transcribeSelectedFile() {
    if (!selectedFilePath) return;
    await processResult(window.deskScribe.transcribeFile(selectedFilePath, currentLanguage()));
  }

  async function transcribeLastRecording() {
    if (!lastRecording) return;
    await processResult(window.deskScribe.transcribeRecording(recordingToTranscriptionRequest(lastRecording)));
  }

  async function exportCurrentTranscript(format: ExportFormat) {
    if (!currentTranscript) return;
    const filePath = await window.deskScribe.exportTranscript(currentTranscript, format);
    if (filePath) {
      setPathText(refs.exportPath, filePath, "导出后会自动定位文件位置。");
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
    if (open) {
      void refreshManagedModels();
      void window.deskScribe.getUpdateState().then((next) => {
        updateState = next;
        renderUpdateState();
      });
    }
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

  [
    refs.languageSelect,
    refs.themeSelect,
    refs.closeBehaviorSelect,
    refs.defaultLanguageSelect,
    refs.transcriptionEngineSelect,
    refs.recordingSourceSelect
  ].forEach(bindCustomSelect);

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
  refs.modeToggle.addEventListener("click", () => {
    const nextMode: WindowMode = windowMode === "compact" ? "full" : "compact";
    applyWindowMode(nextMode);
    void window.deskScribe.setWindowMode(nextMode);
  });
  refs.refreshWindow.addEventListener("click", () => {
    if (!refs.refreshWindow.disabled) {
      void window.deskScribe.reloadWindow();
    }
  });
  refs.pinWindow.addEventListener("click", () => {
    void window.deskScribe.toggleAlwaysOnTop().then((active) => {
      refs.pinWindow.classList.toggle("is-active", active);
      const icon = refs.pinWindow.querySelector("i");
      if (icon) {
        icon.className = active ? "ri-pushpin-2-fill" : "ri-pushpin-line";
      }
      refs.pinWindow.setAttribute("aria-pressed", String(active));
      refs.pinWindow.title = active ? "取消置顶" : "置顶窗口";
      refs.pinWindow.setAttribute("aria-label", refs.pinWindow.title);
    });
  });
  refs.minimizeWindow.addEventListener("click", () => {
    void window.deskScribe.minimizeWindow();
  });
  refs.maximizeWindow.addEventListener("click", () => {
    void window.deskScribe.toggleMaximizeWindow().then(syncMaximizeButton);
  });
  refs.closeWindow.addEventListener("click", () => {
    void window.deskScribe.closeWindow();
  });

  refs.checkUpdate.addEventListener("click", () => {
    void window.deskScribe.checkForUpdates().then((next) => {
      updateState = next;
      renderUpdateState();
    }).catch((error) => {
      updateState = { ...updateState, phase: "error", message: normalizeErrorMessage(error) };
      renderUpdateState();
    });
  });
  refs.downloadUpdate.addEventListener("click", () => {
    void window.deskScribe.downloadUpdate().catch((error) => {
      updateState = { ...updateState, phase: "error", message: normalizeErrorMessage(error) };
      renderUpdateState();
    });
  });
  refs.installUpdate.addEventListener("click", () => {
    void window.deskScribe.installUpdate().catch((error) => {
      updateState = { ...updateState, phase: "error", message: normalizeErrorMessage(error) };
      renderUpdateState();
    });
  });
  refs.openModelsDirectory.addEventListener("click", () => {
    void window.deskScribe.openModelsDirectory().catch((error) => setStatus(normalizeErrorMessage(error)));
  });
  refs.modelList.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-model-action]")
      : null;
    if (!button) return;
    const model = managedModels.find((item) => item.id === button.dataset.modelId);
    if (!model) return;
    const action = button.dataset.modelAction;
    if (action === "use") {
      void applyModelSelection(model);
      return;
    }
    if (action === "download") {
      modelDownloadProgress.set(model.id, {
        modelId: model.id,
        phase: "downloading",
        transferredBytes: 0,
        totalBytes: model.sizeBytes,
        percent: 0,
        message: `正在连接 ${model.displayName} 下载源`
      });
      renderModelLibrary();
      void window.deskScribe.downloadManagedModel(model.id).then(async () => {
        await refreshManagedModels();
        const installed = managedModels.find((item) => item.id === model.id);
        if (installed?.installed) {
          await applyModelSelection(installed);
        }
      }).catch((error) => setStatus(normalizeErrorMessage(error)));
      return;
    }
    if (action === "cancel") {
      void window.deskScribe.cancelManagedModelDownload(model.id);
    }
  });

  window.addEventListener("keydown", (event) => {
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
  refs.transcribeRecording.addEventListener("click", () => {
    void transcribeLastRecording();
  });
  refs.cancelTranscription.addEventListener("click", () => {
    refs.cancelTranscription.disabled = true;
    if (isLiveTranscribing) {
      liveTranscriptionStopped = true;
      liveTranscriptionPending = false;
      refs.liveTranscriptionCheckbox.checked = false;
      setStatus("正在取消实时转写预览，录音会继续。");
    } else {
      setStatus("正在取消转写。");
    }
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
  onCustomSelectChange(refs.transcriptionEngineSelect, async () => {
    preferences.transcriptionEngine = getCustomSelectValue<AppPreferences["transcriptionEngine"]>(refs.transcriptionEngineSelect);
    if (preferences.transcriptionEngine === "faster-whisper") {
      setStatus(`已切换到 Faster-Whisper，当前模型为 ${preferences.fasterWhisperModel}。`);
    } else {
      setStatus(`已切换到 Whisper.cpp，当前模型为 ${preferences.whisperCppModel}。`);
    }
    await persistPreferences();
  });
  refs.disableGpuCheckbox.addEventListener("change", async () => {
    preferences.disableGpu = refs.disableGpuCheckbox.checked;
    await persistPreferences();
  });
  refs.whisperThreadsInput.addEventListener("change", async () => {
    const maxThreads = Math.max(1, Number(refs.whisperThreadsInput.max || navigator.hardwareConcurrency || 4));
    const next = Math.floor(Number(refs.whisperThreadsInput.value || 0));
    preferences.whisperThreads = Math.max(0, Math.min(next, maxThreads));
    await persistPreferences();
  });

  refs.pickExportDirectory.addEventListener("click", () => {
    void bindPicker(window.deskScribe.selectExportDirectory, (value) => {
      preferences.exportDirectory = value;
    });
  });
  void window.deskScribe.getPreferences().then((loaded) => {
    preferences = loaded;
    syncPreferencesToUi();
  }).catch(() => {
    syncPreferencesToUi();
  });

  const unsubscribeProgress = window.deskScribe.onTranscriptionProgress(applyTranscriptionProgress);
  const unsubscribeModelProgress = window.deskScribe.onModelDownloadProgress((progress) => {
    modelDownloadProgress.set(progress.modelId, progress);
    renderModelLibrary();
    if (progress.phase === "completed") {
      void refreshManagedModels();
    }
  });
  const unsubscribeUpdateState = window.deskScribe.onUpdateState((next) => {
    updateState = next;
    renderUpdateState();
  });
  const refreshModelsOnFocus = () => {
    if (!refs.settingsPanel.hidden) {
      void refreshManagedModels();
    }
  };
  window.addEventListener("focus", refreshModelsOnFocus);
  void refreshManagedModels();
  void window.deskScribe.getUpdateState().then((next) => {
    updateState = next;
    renderUpdateState();
  });

  renderTranscript(null);
  applyWindowMode(initialWindowMode());
  resetProcessView("选择音频或结束录音后，会在这里显示转换、识别和整理状态。");
  setRecorderState("idle");
  updateElapsed(0);

  window.addEventListener("beforeunload", () => {
    window.clearInterval(tickTimer);
    window.clearInterval(meterTimer);
    unsubscribeProgress();
    unsubscribeModelProgress();
    unsubscribeUpdateState();
    window.removeEventListener("focus", refreshModelsOnFocus);
    cleanupAudio();
  });
}
