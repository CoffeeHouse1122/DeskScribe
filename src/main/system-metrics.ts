import { execFile } from "node:child_process";
import os from "node:os";
import type { SystemMetrics } from "../shared/types";

interface CpuSnapshot {
  idle: number;
  total: number;
}

const GPU_SAMPLE_INTERVAL_MS = 6000;
const GPU_QUERY_TIMEOUT_MS = 4500;

let previousCpuSnapshot = readCpuSnapshot();
let cachedGpuPercent: number | null = null;
let lastGpuSampleAt = 0;
let gpuSampleInFlight: Promise<number | null> | null = null;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function calculateCpuPercent(previous: CpuSnapshot, current: CpuSnapshot) {
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return 0;
  const idleDelta = current.idle - previous.idle;
  return clampPercent((1 - idleDelta / totalDelta) * 100);
}

function readCpuSnapshot(): CpuSnapshot {
  return os.cpus().reduce<CpuSnapshot>((snapshot, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    snapshot.idle += cpu.times.idle;
    snapshot.total += total;
    return snapshot;
  }, { idle: 0, total: 0 });
}

function queryWindowsGpu(): Promise<number | null> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$engines = Get-CimInstance -Namespace root\\cimv2 -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine",
    "$values = @($engines | Where-Object { $_.Name -match 'engtype_(3D|Compute|Cuda|Graphics|VideoDecode|VideoEncode)' } | ForEach-Object { [double]$_.UtilizationPercentage })",
    "if ($values.Count -eq 0) { 'NA' } else { [Math]::Round(($values | Measure-Object -Maximum).Maximum, 1).ToString([Globalization.CultureInfo]::InvariantCulture) }"
  ].join("; ");

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: GPU_QUERY_TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const value = Number.parseFloat(stdout.trim());
        resolve(Number.isFinite(value) ? clampPercent(value) : null);
      }
    );
  });
}

async function readGpuPercent() {
  if (process.platform !== "win32") return null;
  const now = Date.now();
  if (now - lastGpuSampleAt < GPU_SAMPLE_INTERVAL_MS) {
    return cachedGpuPercent;
  }
  if (!gpuSampleInFlight) {
    gpuSampleInFlight = queryWindowsGpu().then((value) => {
      cachedGpuPercent = value;
      lastGpuSampleAt = Date.now();
      return value;
    }).finally(() => {
      gpuSampleInFlight = null;
    });
  }
  return gpuSampleInFlight;
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const currentCpuSnapshot = readCpuSnapshot();
  const cpuPercent = calculateCpuPercent(previousCpuSnapshot, currentCpuSnapshot);
  previousCpuSnapshot = currentCpuSnapshot;

  const totalMemory = os.totalmem();
  const memoryPercent = totalMemory > 0
    ? clampPercent(((totalMemory - os.freemem()) / totalMemory) * 100)
    : 0;
  const gpuPercent = await readGpuPercent();

  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryPercent: Math.round(memoryPercent * 10) / 10,
    gpuPercent,
    gpuAvailable: gpuPercent !== null,
    sampledAt: Date.now()
  };
}
