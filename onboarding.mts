import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalState } from './state.mts';
import { readWatch } from './watcher.mts';
import { readNative, type NativeReader } from './native.mts';

export const LABEL = 'com.agent-ramsey.watch';
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function launchPlist(node: string, cli: string, root: string) {
  if (![node, cli, root].every(p => p.startsWith('/') && !/[\x00-\x1f]/.test(p))) throw new Error('Absolute, printable paths are required');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(cli)}</string><string>watch-once</string><string>--json</string></array><key>EnvironmentVariables</key><dict><key>RAMSEY_STATE_DIR</key><string>${xml(root)}</string></dict><key>RunAtLoad</key><true/><key>StartInterval</key><integer>300</integer><key>ProcessType</key><string>Background</string><key>LowPriorityIO</key><true/><key>Nice</key><integer>10</integer><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`;
}
function context() {
  if (process.platform !== 'darwin' || !process.getuid) throw new Error('Onboarding requires a logged-in macOS user');
  const root = new LocalState().root;
  const dir = join(homedir(), 'Library', 'LaunchAgents');
  return { root, dir, path: join(dir, `${LABEL}.plist`), domain: `gui/${process.getuid()}`, expected: launchPlist(process.execPath, resolve(dirname(fileURLToPath(import.meta.url)), 'cli.mts'), root) };
}
function ownedFile(path: string, expected: string) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.size > 16384 || readFileSync(path, 'utf8') !== expected) throw new Error('Existing LaunchAgent differs from this installation. Review it before replacing or removing it.');
}
export function verifyLoadedArguments(output: string) {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), 'cli.mts');
  if (!output.includes(process.execPath) || !output.includes(cli) || !output.includes('watch-once')) throw new Error('Loaded LaunchAgent has unexpected arguments; review it before changing it.');
}
function loaded(read: NativeReader, domain: string): boolean {
  let output: string;
  try { output = read('/bin/launchctl', ['print', `${domain}/${LABEL}`]); } catch { return false; }
  verifyLoadedArguments(output);
  return true;
}
export function onboard(read: NativeReader = readNative) {
  const c = context();
  mkdirSync(c.dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(c.dir);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()) throw new Error('LaunchAgents must be an owned directory');
  if (existsSync(c.path)) ownedFile(c.path, c.expected);
  else writeFileSync(c.path, c.expected, { flag: 'wx', mode: 0o600 });
  if (!loaded(read, c.domain)) read('/bin/launchctl', ['bootstrap', c.domain, c.path]);
  if (!loaded(read, c.domain)) throw new Error('LaunchAgent did not load. Run ramsey status.');
  return { onboarded: true, intervalSeconds: 300, startsAtLogin: true, localNotifications: 'macOS permission dependent', note: 'One short native check every five minutes. No resident model. Keep this checkout and Node executable in place.' };
}
export function monitorStatus(read: NativeReader = readNative) {
  const c = context();
  if (existsSync(c.path)) ownedFile(c.path, c.expected);
  const last = readWatch(c.root);
  return { installed: existsSync(c.path), loaded: loaded(read, c.domain), fresh: last !== null && Date.now() - Date.parse(last.checkedAt) >= 0 && Date.now() - Date.parse(last.checkedAt) < 15 * 60000, last, intervalSeconds: 300, note: 'Runs after login while the Mac is awake. No checks during sleep or logout. Notification delivery is not verified.' };
}
export function offboard(read: NativeReader = readNative) {
  const c = context();
  if (!existsSync(c.path)) return { removed: false, note: 'No owned LaunchAgent found.' };
  ownedFile(c.path, c.expected);
  if (loaded(read, c.domain)) read('/bin/launchctl', ['bootout', `${c.domain}/${LABEL}`]);
  if (loaded(read, c.domain)) throw new Error('Monitor is still loaded; the file was retained.');
  unlinkSync(c.path);
  return { removed: true, historyRetained: true };
}
