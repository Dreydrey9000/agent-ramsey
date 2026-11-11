import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { readNative as command } from './native.mts';

export type ProcessRow = {
  pid: number; ppid: number; started: string; cpuSeconds: number;
  rssKiB: number; executable: string;
};
export type Snapshot = { at: number; processes: ProcessRow[] };
export type AppUsage = {
  id: string; name: string; cpuPercent: number; peakCpuPercent: number;
  busyIntervals: number; measuredIntervals: number; rssGiB: number;
  processCount: number; pids: number[];
};

// Only executable names, never argv or environment variables, enter the report.
const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 100);

export function cpuSeconds(value: string): number {
  const match = value.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) throw new Error('Unrecognized process CPU time');
  return Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600
    + Number(match[3]) * 60 + Number(match[4]);
}

export function parseProcesses(output: string): ProcessRow[] {
  const lines = output.split('\n').filter(line => line.trim());
  if (!lines.length) throw new Error('No process readings returned');
  return lines.map(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+([\d:.\-]+)\s+(\d+)\s+(.+)$/);
    if (!m) throw new Error('Process output changed; refusing an incomplete ranking');
    return { pid: Number(m[1]), ppid: Number(m[2]), started: m[3],
      cpuSeconds: cpuSeconds(m[4]), rssKiB: Number(m[5]), executable: m[6] };
  });
}

function appBundle(executable: string): string | undefined {
  return executable.match(/^(.+?\.app)(?:\/|$)/)?.[1];
}

export function groupFor(row: ProcessRow, rows: Map<number, ProcessRow>): string {
  let current: ProcessRow | undefined = row;
  const seen = new Set<number>();
  while (current && !seen.has(current.pid)) {
    seen.add(current.pid);
    const bundle = appBundle(current.executable);
    if (bundle) return bundle;
    current = rows.get(current.ppid);
  }
  return row.executable;
}

export function appLabel(group: string): string {
  return clean(group.split('/').pop()?.replace(/\.app$/, '') || 'unknown');
}

export function summarize(snapshots: Snapshot[]): AppUsage[] {
  if (snapshots.length < 2) throw new Error('At least two snapshots are required');
  const duration = (snapshots.at(-1)!.at - snapshots[0].at) / 1000;
  if (duration <= 0) throw new Error('Sample time must increase');
  const apps = new Map<string, { cpu: number[]; latest: ProcessRow[] }>();
  for (let i = 1; i < snapshots.length; i++) {
    const elapsed = (snapshots[i].at - snapshots[i - 1].at) / 1000;
    if (elapsed <= 0) throw new Error('Sample time must increase');
    const before = new Map(snapshots[i - 1].processes.map(row => [row.pid, row]));
    const after = new Map(snapshots[i].processes.map(row => [row.pid, row]));
    const intervalGroups = new Map<string, { cpu: number; rows: ProcessRow[] }>();
    for (const row of after.values()) {
      const key = groupFor(row, after);
      const group = intervalGroups.get(key) ?? { cpu: 0, rows: [] };
      const previous = before.get(row.pid);
      // PID reuse and newly seen processes do not inherit another process's CPU time.
      if (previous?.started === row.started) {
        group.cpu += Math.max(0, row.cpuSeconds - previous.cpuSeconds);
      }
      group.rows.push(row);
      intervalGroups.set(key, group);
    }
    for (const [key, group] of intervalGroups) {
      const app = apps.get(key) ?? { cpu: Array<number>(snapshots.length - 1).fill(0), latest: [] };
      app.cpu[i - 1] = group.cpu / elapsed * 100;
      if (i === snapshots.length - 1) app.latest = group.rows;
      apps.set(key, app);
    }
  }
  const intervals = snapshots.slice(1).map((s, i) => (s.at - snapshots[i].at) / 1000);
  return [...apps].map(([key, app]) => ({
    id: createHash('sha256').update(key).digest('hex').slice(0, 24),
    name: appLabel(key),
    cpuPercent: app.cpu.reduce((sum, cpu, i) => sum + cpu * intervals[i], 0) / duration,
    peakCpuPercent: Math.max(...app.cpu), busyIntervals: app.cpu.filter(cpu => cpu >= 50).length,
    measuredIntervals: intervals.length,
    rssGiB: app.latest.reduce((sum, row) => sum + row.rssKiB, 0) / 1048576,
    processCount: app.latest.length, pids: app.latest.map(row => row.pid).slice(0, 20),
  }));
}

export function snapshot(): Snapshot {
  const output = command('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,lstart=,time=,rss=,comm=']);
  return { at: performance.now(), processes: parseProcesses(output) };
}

export function pressureName(value: number): string {
  return ({ 1: 'normal', 2: 'warning', 4: 'critical' } as Record<number, string>)[value] ?? 'unknown';
}

export function parseSwap(output: string): number {
  const m = output.match(/used\s*=\s*([\d.]+)([KMG])/);
  if (!m) throw new Error('Unrecognized swap usage');
  return Number(m[1]) * ({ K: 1024, M: 1048576, G: 1073741824 }[m[2]]!);
}

export function parseCompressed(output: string): number {
  const size = output.match(/page size of (\d+) bytes/);
  const pages = output.match(/Pages occupied by compressor:\s*(\d+)/);
  if (!size || !pages) throw new Error('Unrecognized VM statistics');
  return Number(size[1]) * Number(pages[1]);
}

export function parseHeadroom(output: string): number {
  const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1]);
  const counts = ['free', 'speculative', 'purgeable'].map(name => {
    const m = output.match(new RegExp(`Pages ${name}:\\s*(\\d+)`));
    if (!m) throw new Error('Missing headroom measurement');
    return Number(m[1]);
  });
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('Invalid page size');
  // A conservative estimate. Inactive/compressed memory is deliberately excluded.
  return counts.reduce((sum, count) => sum + count, 0) * pageSize;
}

export function systemState(readCommand: typeof command = command) {
  const unavailable: string[] = [];
  let vm: string | undefined;
  const vmStats = () => vm ??= readCommand('/usr/bin/vm_stat', []);
  function optional<T>(name: string, read: () => T): T | null {
    try { return read(); } catch { unavailable.push(name); return null; }
  }
  function numeric(key: string): number {
    const raw = readCommand('/usr/sbin/sysctl', ['-n', key]).trim();
    if (!/^\d+$/.test(raw)) throw new Error('Invalid system measurement');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || (key.startsWith('hw.') && value === 0)) {
      throw new Error('Invalid system measurement');
    }
    return value;
  }
  return {
    totalMemoryBytes: optional('total memory', () => numeric('hw.memsize')),
    logicalCpus: optional('CPU count', () => numeric('hw.logicalcpu')),
    memoryPressure: optional('memory pressure', () => pressureName(numeric('kern.memorystatus_vm_pressure_level'))),
    swapUsedBytes: optional('swap usage', () => parseSwap(readCommand('/usr/sbin/sysctl', ['vm.swapusage']))),
    compressedBytes: optional('compressed memory', () => parseCompressed(vmStats())),
    headroomBytes: optional('headroom estimate', () => parseHeadroom(vmStats())),
    battery: optional('power source', () => {
      const raw = readCommand('/usr/bin/pmset', ['-g', 'batt']).trim();
      if (!raw.includes('Now drawing from')) throw new Error('Unrecognized power source');
      return raw.replace(/\(id=[^)]+\)/g, '(battery)').split('\n').map(clean).join(' ');
    }),
    localAiGuard: {
      installed: existsSync(`${homedir()}/.local/bin/local-ai-guard`),
      disabledLatch: existsSync(`${homedir()}/.codex/local-ai-router/DISABLED`),
      note: 'File checks only. Watchdog health and model residency are not verified.',
    },
    energyWatts: null,
    unavailable,
  };
}

export type Report = {
  version: 1; capturedAt: string; windowSeconds: number;
  start: ReturnType<typeof systemState>; end: ReturnType<typeof systemState>;
  topCpu: AppUsage[]; topMemory: AppUsage[]; limitations: string[];
};

export async function collect(samples: number, intervalSeconds: number, onSnapshot?: (s: Snapshot) => void): Promise<Report> {
  if (process.platform !== 'darwin') throw new Error('RAMsey requires macOS');
  if (!Number.isInteger(samples) || samples < 1 || samples > 12 || !Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 10) throw new Error('Sample settings are outside supported bounds');
  const start = systemState();
  const snapshots = [snapshot()];
  onSnapshot?.(snapshots[0]);
  for (let i = 0; i < samples; i++) {
    await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
    snapshots.push(snapshot());
    onSnapshot?.(snapshots.at(-1)!);
  }
  const apps = summarize(snapshots);
  return {
    version: 1, capturedAt: new Date().toISOString(),
    windowSeconds: (snapshots.at(-1)!.at - snapshots[0].at) / 1000,
    start, end: systemState(),
    topCpu: [...apps].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 8),
    topMemory: [...apps].sort((a, b) => b.rssGiB - a.rssGiB).slice(0, 8),
    limitations: [
      'CPU 100% means one logical core. These are interval CPU-time deltas, not lifetime ps averages.',
      'Exited, short-lived and newly seen processes can be missed. CPU totals may undercount.',
      'Memory is end-of-window summed resident size (RSS); shared pages may be counted more than once. It is not unique RAM or reclaimable memory.',
      'Apps include observed helper processes and descendants. Launchd-owned helpers may remain separate.',
      'A short sample cannot establish idleness, a memory leak, or runaway behavior. High swap alone is not current memory pressure.',
      'The base CPU/memory sample does not measure per-app energy, GPU load, disk space or network activity. Additional diagnostics identify their own sources.',
      'No process arguments, environment values, screenshots, browser history or project files are recorded.',
      'No apps were stopped and no system settings were changed.',
    ],
  };
}
