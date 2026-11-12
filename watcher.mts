import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalState } from './state.mts';
import { pressureName } from './monitor.mts';
import { readNative, type NativeReader } from './native.mts';

export type WatchState = { schema: 1; checkedAt: string; pressure: string; consecutive: number; lastNoticeAt: number; notice: string | null; notification: string };
const pressures = ['normal', 'warning', 'critical', 'unknown'];
export function watchDecision(previous: WatchState | null, pressure: string | null, now: number): WatchState {
  const current = pressures.includes(pressure ?? '') ? pressure! : 'unknown';
  const recent = previous !== null && now - Date.parse(previous.checkedAt) >= 0 && now - Date.parse(previous.checkedAt) < 15 * 60000;
  const consecutive = recent && previous.pressure === current ? Math.min(previous.consecutive + 1, 1000) : 1;
  const lastNoticeAt = previous !== null && previous.lastNoticeAt <= now ? previous.lastNoticeAt : 0;
  const actionable = current === 'critical' || (current === 'warning' && consecutive >= 2) || (current === 'unknown' && consecutive >= 3);
  const escalation = current === 'critical' && previous?.pressure !== 'critical';
  const due = actionable && (escalation || lastNoticeAt === 0 || now - lastNoticeAt >= 60 * 60000);
  const notice = due ? (current === 'unknown' ? 'Resource readings are unavailable. Run ramsey status, then ramsey check.' : 'Memory pressure is elevated. Defer heavy jobs and run ramsey check before changing any app.') : null;
  return { schema: 1, checkedAt: new Date(now).toISOString(), pressure: current, consecutive, lastNoticeAt: due ? now : lastNoticeAt, notice, notification: due ? 'pending' : 'not-due' };
}
export function watchPath(root: string) { return join(root, 'watch.json'); }
export function readWatch(root: string): WatchState | null {
  const path = watchPath(root);
  if (!existsSync(path)) return null;
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192 || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077)) throw new Error('Unsafe monitor state');
  const value = JSON.parse(readFileSync(path, 'utf8')) as WatchState;
  if (value?.schema !== 1 || !pressures.includes(value.pressure) || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) || new Date(value.checkedAt).toISOString() !== value.checkedAt || !Number.isInteger(value.consecutive) || value.consecutive < 1 || value.consecutive > 1000 || !Number.isFinite(value.lastNoticeAt) || value.lastNoticeAt < 0 || value.lastNoticeAt > Date.parse(value.checkedAt) || !(value.notice === null || typeof value.notice === 'string' && value.notice.length <= 500) || (typeof value.notification !== 'string' || value.notification.length > 300)) throw new Error('Invalid monitor state');
  return value;
}
export function readPressure(read: NativeReader = readNative): string | null {
  try {
    const raw = read('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']).trim();
    return /^\d+$/.test(raw) ? pressureName(Number(raw)) : null;
  } catch { return null; }
}
export function watchOnce(store = new LocalState(), getPressure: () => string | null = readPressure, notify: NativeReader = readNative) {
  const root = store.root;
  // launchd serializes this label. No crash-persistent lock can disable future checks.
  let previous: WatchState | null;
  let recovered = false;
  try { previous = readWatch(root); }
  catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof Error && error.message === 'Invalid monitor state')) throw error;
    const backup = join(root, 'watch-invalid.json');
    if (existsSync(backup) && lstatSync(backup).isSymbolicLink()) throw new Error('Unsafe monitor backup');
    renameSync(watchPath(root), backup);
    previous = null; recovered = true;
  }
  const state = watchDecision(previous, getPressure(), Date.now());
  if (recovered) state.notification = 'Invalid monitor state preserved as watch-invalid.json; persistence restarted.';
  if (state.notice) {
    try {
      // Fixed local notification text; no app names, paths or outbound services.
      notify('/usr/bin/osascript', ['-e', state.pressure === 'unknown'
        ? 'display notification "Resource readings unavailable. Run ramsey status, then ramsey check." with title "Agent RAMsey"'
        : 'display notification "Memory pressure elevated. Defer heavy jobs and run ramsey check." with title "Agent RAMsey"']);
      state.notification = 'requested; delivery depends on macOS notification permissions';
    } catch { state.notification = 'unavailable; see ramsey status'; }
  }
  const temp = `${watchPath(root)}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); renameSync(temp, watchPath(root)); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
  return state;
}
