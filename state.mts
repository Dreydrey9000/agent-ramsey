import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppUsage, ProcessRow, Report } from './monitor.mts';

export const WORKLOADS = ['unknown', 'idle', 'render', 'upload', 'record', 'call', 'indexing', 'local-model', 'development', 'other'] as const;
export type Workload = typeof WORKLOADS[number];
export type ActiveWork = { pid: number; started: string; kind: Workload; registeredAt: string; expiresAt: string };
export type HistoryEntry = {
  schema: 2; id: string; installationId: string; capturedAt: string;
  workload: Workload; samples: number; interval: number; windowSeconds: number;
  totalMemoryBytes: number | null; pressure: string | null; swapUsedBytes: number | null;
  apps: Pick<AppUsage, 'id' | 'name' | 'cpuPercent' | 'rssGiB'>[];
};
const DAY = 86400000;
const ENTRY_NAME = /^\d{13}-[a-f0-9-]{36}\.json$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function validHistory(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<HistoryEntry>;
  const finite = (n: unknown, minimum = 0): n is number => typeof n === 'number' && Number.isFinite(n) && n >= minimum;
  const bytes = (n: unknown) => n === null || (finite(n) && Number.isSafeInteger(n));
  if (v.schema !== 2 || typeof v.id !== 'string' || !UUID.test(v.id) || typeof v.installationId !== 'string' || !UUID.test(v.installationId)
      || !isWorkload(v.workload) || !Number.isInteger(v.samples) || v.samples! < 1 || v.samples! > 12
      || !Number.isInteger(v.interval) || v.interval! < 1 || v.interval! > 10 || !finite(v.windowSeconds, 0.001) || v.windowSeconds > 3600
      || !bytes(v.totalMemoryBytes) || v.totalMemoryBytes === 0 || !(v.swapUsedBytes === null || finite(v.swapUsedBytes))
      || !(v.pressure === null || ['normal', 'warning', 'critical', 'unknown'].includes(v.pressure ?? ''))
      || typeof v.capturedAt !== 'string' || !Number.isFinite(Date.parse(v.capturedAt))
      || new Date(v.capturedAt).toISOString() !== v.capturedAt || !Array.isArray(v.apps) || v.apps.length > 16) return false;
  const ids = new Set<string>();
  for (const app of v.apps) {
    if (!app || typeof app !== 'object' || typeof app.id !== 'string' || !/^[a-f0-9]{24}$/.test(app.id)
        || typeof app.name !== 'string' || app.name.length < 1 || app.name.length > 100 || /[\x00-\x1f\x7f-\x9f]/.test(app.name)
        || !finite(app.cpuPercent) || !finite(app.rssGiB) || ids.has(app.id)) return false;
    ids.add(app.id);
  }
  return true;
}

function checkedDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new Error('State directory must be an owned, real directory');
  if ((info.mode & 0o077) !== 0) throw new Error('State directory must be private (mode 0700). Review its contents and permissions before using it.');
}

function readJson(path: string): unknown {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Unsafe state file');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function atomicJson(path: string, value: unknown) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Refusing a symbolic-link state file');
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}

export function isWorkload(value: unknown): value is Workload {
  return typeof value === 'string' && (WORKLOADS as readonly string[]).includes(value);
}

export function compareEntries(before: HistoryEntry, after: HistoryEntry) {
  const reasons: string[] = [];
  if (!validHistory(before) || !validHistory(after)) {
    return { comparable: false, reasons: ['One or both checks contain invalid measurements'], before: before?.capturedAt ?? null,
      after: after?.capturedAt ?? null, changes: [], note: 'Invalid data is never coerced into zero.' };
  }
  if (before.totalMemoryBytes === null || after.totalMemoryBytes === null) reasons.push('Physical-memory identity is unavailable');
  if (before.installationId !== after.installationId || before.totalMemoryBytes !== after.totalMemoryBytes) reasons.push('Different host installation or physical memory');
  if (before.workload === 'unknown' || before.workload !== after.workload) reasons.push('Workload is unknown or different');
  if (before.samples !== after.samples || before.interval !== after.interval) reasons.push('Different sample settings');
  if (Math.abs(before.windowSeconds - after.windowSeconds) > Math.max(before.windowSeconds, after.windowSeconds) * 0.15) reasons.push('Observation durations differ by more than 15%');
  if (Date.parse(after.capturedAt) <= Date.parse(before.capturedAt)) reasons.push('Checks are not ordered in time');
  const old = new Map(before.apps.map(app => [app.id, app]));
  const changes = reasons.length ? [] : after.apps.flatMap(app => {
    const previous = old.get(app.id);
    return previous ? [{ name: app.name, rssDeltaMiB: (app.rssGiB - previous.rssGiB) * 1024,
      cpuDeltaPercentagePoints: app.cpuPercent - previous.cpuPercent }] : [];
  });
  return { comparable: reasons.length === 0, reasons, before: before.capturedAt, after: after.capturedAt,
    changes, note: 'RSS deltas are summed resident-memory changes, not reclaimed RAM or proof of a leak. Apps absent from either check are not treated as zero.' };
}

export function trends(entries: HistoryEntry[]) {
  const latest = entries.slice(-3);
  if (latest.length < 3 || !compareEntries(latest[0], latest[1]).comparable || !compareEntries(latest[1], latest[2]).comparable
      || Date.parse(latest[2].capturedAt) - Date.parse(latest[0].capturedAt) < 30000) return [];
  return latest[2].apps.flatMap(app => {
    const a = latest[0].apps.find(v => v.id === app.id);
    const b = latest[1].apps.find(v => v.id === app.id);
    if (!a || !b || b.rssGiB - a.rssGiB < 16 / 1024 || app.rssGiB - b.rssGiB < 16 / 1024 || app.rssGiB - a.rssGiB < 128 / 1024) return [];
    return [{ name: app.name, growthMiB: (app.rssGiB - a.rssGiB) * 1024,
      checks: 3, assessment: 'Growing across three comparable checks. Investigate the workload before calling this a leak.' }];
  });
}

export class LocalState {
  readonly root: string;
  constructor(root = process.env.RAMSEY_STATE_DIR ?? join(homedir(), '.local', 'state', 'ramsey')) {
    this.root = root;
    checkedDirectory(root);
  }
  private installationId(): string {
    const path = join(this.root, 'installation.json');
    if (!existsSync(path)) {
      try { writeFileSync(path, JSON.stringify({ id: randomUUID() }), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const data = readJson(path) as { id?: unknown };
    if (typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) throw new Error('Invalid installation identity');
    return data.id;
  }
  history(now = Date.now()): HistoryEntry[] {
    const dir = join(this.root, 'history');
    checkedDirectory(dir);
    const names = readdirSync(dir).filter(name => ENTRY_NAME.test(name)).sort();
    const kept = names.filter(name => Number(name.slice(0, 13)) >= now - 14 * DAY).slice(-100);
    for (const name of names) if (!kept.includes(name)) {
      try { unlinkSync(join(dir, name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return kept.flatMap(name => {
      let data: HistoryEntry;
      try { data = readJson(join(dir, name)) as HistoryEntry; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
      if (!validHistory(data) || Number(name.slice(0, 13)) !== Date.parse(data.capturedAt) || !name.endsWith(`${data.id}.json`)) throw new Error('Invalid history entry');
      return [data];
    });
  }
  record(report: Report, workload: Workload, samples: number, interval: number): HistoryEntry {
    const apps = [...new Map([...report.topCpu, ...report.topMemory].map(app => [app.id, app])).values()];
    const entry: HistoryEntry = { schema: 2, id: randomUUID(), installationId: this.installationId(),
      capturedAt: report.capturedAt, workload, samples, interval, windowSeconds: report.windowSeconds,
      totalMemoryBytes: report.end.totalMemoryBytes, pressure: report.end.memoryPressure, swapUsedBytes: report.end.swapUsedBytes,
      apps: apps.map(({ id, name, cpuPercent, rssGiB }) => ({ id, name, cpuPercent, rssGiB })) };
    if (!validHistory(entry)) throw new Error('Invalid history measurements. No history entry was saved.');
    const dir = join(this.root, 'history');
    checkedDirectory(dir);
    atomicJson(join(dir, `${String(Date.parse(entry.capturedAt)).padStart(13, '0')}-${entry.id}.json`), entry);
    this.history();
    return entry;
  }
  work(rows: ProcessRow[], now = Date.now()): ActiveWork[] {
    const path = join(this.root, 'work.json');
    if (!existsSync(path)) return [];
    const data = readJson(path) as unknown;
    if (!Array.isArray(data) || data.length > 50) throw new Error('Invalid active-work registry');
    const live = new Map(rows.map(row => [row.pid, row.started]));
    return (data as ActiveWork[]).filter(item => isWorkload(item.kind) && Number.isInteger(item.pid)
      && typeof item.started === 'string' && Date.parse(item.expiresAt) > now && live.get(item.pid) === item.started);
  }
  private mutateWork<T>(action: () => T): T {
    const lock = join(this.root, 'work.lock');
    let fd: number;
    try { fd = openSync(lock, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Active-work registry is busy. Retry after the other command finishes.'); throw error; }
    try { return action(); }
    finally { closeSync(fd); unlinkSync(lock); }
  }
  protect(row: ProcessRow, kind: Workload, ttlMinutes: number, rows: ProcessRow[]): ActiveWork {
    if (!isWorkload(kind) || kind === 'unknown' || !Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) throw new Error('A known work kind and TTL from 1 to 1440 minutes are required');
    return this.mutateWork(() => {
      const work = this.work(rows).filter(item => item.pid !== row.pid);
      if (work.length >= 50) throw new Error('Active-work registry is full');
      const entry = { pid: row.pid, started: row.started, kind, registeredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString() };
      atomicJson(join(this.root, 'work.json'), [...work, entry]);
      return entry;
    });
  }
  unprotect(pid: number, rows: ProcessRow[]) {
    return this.mutateWork(() => {
      const work = this.work(rows);
      const remaining = work.filter(item => item.pid !== pid);
      atomicJson(join(this.root, 'work.json'), remaining);
      return { removed: work.length - remaining.length, note: 'Only a registry entry changed. Unknown work remains protected by default.' };
    });
  }
}
