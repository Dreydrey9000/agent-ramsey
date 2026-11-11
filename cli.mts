import { pathToFileURL } from 'node:url';
import { collect, type Report } from './monitor.mts';
import { snapshot, systemState, type Snapshot } from './monitor.mts';
import { cpuIdle, energyDiagnostics } from './energy.mts';
import { annotateWork, helperDiagnostics } from './helpers.mts';
import { compareEntries, isWorkload, LocalState, trends, type Workload } from './state.mts';
import { assessCapacity } from './preflight.mts';

const COMMANDS = ['check', 'history', 'compare', 'helpers', 'work', 'protect', 'unprotect', 'preflight', 'energy', 'version'] as const;
type Command = typeof COMMANDS[number];
export type Options = { command: Command; samples: number; interval: number; json: boolean; help: boolean;
  workload: Workload; noHistory: boolean; pid: number | null; kind: Workload; ttlMinutes: number;
  memoryGiB: number | null; cpuCores: number | null };

export function parseArgs(args: string[]) {
  const options: Options = { command: 'check', samples: 3, interval: 5, json: false, help: false,
    workload: 'unknown', noHistory: false, pid: null, kind: 'unknown', ttlMinutes: 120, memoryGiB: null, cpuCores: null };
  if (args[0] && !args[0].startsWith('-')) {
    if (!(COMMANDS as readonly string[]).includes(args[0])) throw new Error('Unknown command. Run ramsey --help.');
    options.command = args[0] as Command;
    args = args.slice(1);
  }
  const used = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--no-history') { options.noHistory = true; used.add(arg); }
    else if (arg === '--workload' || arg === '--kind' || arg === '--job') {
      const value = args[++i];
      if (!isWorkload(value)) throw new Error('Work kind is not supported. Run ramsey --help.');
      if (arg === '--workload') options.workload = value;
      else options.kind = value;
      used.add(arg);
    }
    else if (arg === '--pid' || arg === '--ttl-minutes' || arg === '--memory-gib' || arg === '--cpu-cores') {
      const raw = args[++i];
      const value = Number(raw);
      if (!raw || !/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(value) || value <= 0) throw new Error(`${arg} requires a positive number`);
      if (arg === '--pid') { if (!Number.isSafeInteger(value) || value > 2147483647) throw new Error('PID must be a positive integer'); options.pid = value; }
      if (arg === '--ttl-minutes') { if (!Number.isInteger(value) || value > 1440) throw new Error('TTL must be 1 to 1440 minutes'); options.ttlMinutes = value; }
      if (arg === '--memory-gib') options.memoryGiB = value;
      if (arg === '--cpu-cores') options.cpuCores = value;
      used.add(arg);
    }
    else if (arg === '--samples' || arg === '--interval') {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 1 || value > (arg === '--samples' ? 12 : 10)) {
        throw new Error(`${arg} requires an integer from 1 to ${arg === '--samples' ? 12 : 10}`);
      }
      if (arg === '--samples') options.samples = value;
      else options.interval = value;
      used.add(arg);
    } else throw new Error(`Unknown option. Run ramsey --help.`);
  }
  const allowed: Record<Command, string[]> = { check: ['--samples', '--interval', '--workload', '--no-history'], history: [], compare: [], helpers: [], work: [],
    protect: ['--pid', '--kind', '--ttl-minutes'], unprotect: ['--pid'], preflight: ['--memory-gib', '--cpu-cores', '--job'], energy: [], version: [] };
  for (const flag of used) if (!allowed[options.command].includes(flag)) throw new Error(`${flag} is not supported for this command`);
  if (!options.help && ['protect', 'unprotect'].includes(options.command) && options.pid === null) throw new Error('This command requires --pid');
  if (!options.help && options.command === 'protect' && options.kind === 'unknown') throw new Error('Protect requires a known --kind');
  return options;
}

const gib = (bytes: number | null) => bytes === null ? 'unavailable' : `${(bytes / 1073741824).toFixed(2)} GiB`;

export function formatReport(report: Report): string {
  const rows = (apps: Report['topCpu']) => apps.map(app =>
    `| ${app.name.replace(/\|/g, '/')} | ${app.cpuPercent.toFixed(1)}% | ${app.rssGiB.toFixed(2)} | ${app.processCount} | ${app.busyIntervals}/${app.measuredIntervals} |`).join('\n');
  const heading = '| App / process group | CPU average | Summed RSS GiB | Processes now | Intervals >=50% CPU |\n|---|---:|---:|---:|---:|';
  const growth = report.start.swapUsedBytes !== null && report.end.swapUsedBytes !== null
    ? `${((report.end.swapUsedBytes - report.start.swapUsedBytes) / 1048576).toFixed(1)} MiB` : 'unavailable';
  return [
    '# RAMsey resource check',
    `Captured ${report.capturedAt}. Observed ${report.windowSeconds.toFixed(1)} seconds.`,
    `Memory pressure: ${report.start.memoryPressure ?? 'unknown'} -> ${report.end.memoryPressure ?? 'unknown'}. Physical memory: ${gib(report.end.totalMemoryBytes)}.`,
    `Swap: ${gib(report.end.swapUsedBytes)} (change: ${growth}). Compressed memory: ${gib(report.end.compressedBytes)}.`,
    `Power: ${report.end.battery ?? 'unavailable'}. Watts: not measured.`,
    '## Largest CPU users', `${heading}\n${rows(report.topCpu)}`,
    '## Largest resident-memory groups', `${heading}\n${rows(report.topMemory)}`,
    '## Interpretation',
    'These are investigation candidates. Confirm whether the leading app is rendering, uploading, indexing or doing other intended work before recommending an interruption.',
    `Local AI guard: ${report.end.localAiGuard.installed ? 'found' : 'not found'}; disabled latch: ${report.end.localAiGuard.disabledLatch ? 'present' : 'absent'}. ${report.end.localAiGuard.note}`,
    `Unavailable system readings: ${[...new Set([...report.start.unavailable, ...report.end.unavailable])].join(', ') || 'none'}.`,
    '## Measurement limits', ...report.limitations.map(value => `- ${value}`), '',
  ].join('\n\n');
}

const HELP = `Agent RAMsey 2.0.0: on-demand Mac resource checks
Usage: ramsey [check] [--samples 1..12] [--interval 1..10] [--workload KIND] [--no-history] [--json]
       ramsey history|compare|helpers|work|energy [--json]
       ramsey protect --pid PID --kind KIND [--ttl-minutes 1..1440] [--json]
       ramsey unprotect --pid PID [--json]
       ramsey preflight [--job KIND] [--memory-gib N] [--cpu-cores N] [--json]
       ramsey version
KIND: idle, render, upload, record, call, indexing, local-model, development, other, unknown
History: up to 100 entries for 14 days. State: RAMSEY_STATE_DIR or ~/.local/state/ramsey.
Default: three 5-second intervals. No daemon, notifications or automatic app control.`;

export async function run(options: Options): Promise<unknown> {
  if (options.command === 'version') return { version: '2.0.0' };
  const state = () => new LocalState();
  if (options.command === 'history' || options.command === 'compare') {
    const entries = state().history();
    if (options.command === 'history') return { entries, growingGroups: trends(entries), retention: '14 days, at most 100 entries' };
    if (entries.length < 2) return { comparable: false, reasons: ['Two checks are required'], changes: [] };
    return { ...compareEntries(entries.at(-2)!, entries.at(-1)!), growingGroups: trends(entries) };
  }
  if (process.platform !== 'darwin') throw new Error('Live diagnostics require macOS. Run the Mac command through your configured connection.');
  if (options.command === 'energy') return energyDiagnostics();
  if (options.command === 'preflight') return assessCapacity(systemState(), energyDiagnostics(), cpuIdle(),
    { memoryGiB: options.memoryGiB, cpuCores: options.cpuCores, kind: options.kind });
  if (['work', 'protect', 'unprotect', 'helpers'].includes(options.command)) {
    const rows = snapshot().processes;
    const store = state();
    if (options.command === 'work') return { activeWork: store.work(rows), unknownWorkProtected: true };
    if (options.command === 'protect') {
      const row = rows.find(row => row.pid === options.pid);
      if (!row) throw new Error('Process is no longer running. Nothing was registered.');
      return { registered: store.protect(row, options.kind, options.ttlMinutes, rows), note: 'Registry metadata only. No process was changed.' };
    }
    if (options.command === 'unprotect') return store.unprotect(options.pid!, rows);
    return helperDiagnostics(rows, store.work(rows));
  }
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  let latest: Snapshot = { at: 0, processes: [] };
  const report = await collect(options.samples, options.interval, value => { latest = value; });
  const store = state();
  const active = store.work(latest.processes);
  const energy = energyDiagnostics();
  const helpers = helperDiagnostics(latest.processes, active);
  let history: unknown = { saved: false };
  if (!options.noHistory) {
    store.record(report, options.workload, options.samples, options.interval);
    const entries = store.history();
    history = { saved: true, entries: entries.length, growingGroups: trends(entries),
      comparison: entries.length >= 2 ? compareEntries(entries.at(-2)!, entries.at(-1)!) : null };
  }
  const cpu = process.cpuUsage(cpuStart);
  return { ...report, version: 2, release: '2.0.0', workload: options.workload, activeWork: annotateWork(latest.processes, active),
    energy, helpers, history, observer: { wallSeconds: (performance.now() - wallStart) / 1000,
      nodeCpuSeconds: (cpu.user + cpu.system) / 1000000, nodeRssMiB: process.memoryUsage().rss / 1048576,
      note: 'Observer values cover the Node process. Native helper CPU and memory are not included.' } };
}

function formatExtended(value: unknown): string {
  const report = value as Report & { version: number; release?: string; energy?: unknown; helpers?: unknown; activeWork?: unknown; history?: unknown; observer?: unknown };
  if (!report.release) return JSON.stringify(value, null, 2);
  return `${formatReport(report)}\n## Additional diagnostics\n\n${JSON.stringify({ energy: report.energy, helpers: report.helpers, activeWork: report.activeWork, history: report.history, observer: report.observer }, null, 2)}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (!options.json && options.command === 'check') console.error(`RAMsey is sampling ${options.samples} intervals of ${options.interval}s...`);
  const report = await run(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatExtended(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`RAMsey: ${error instanceof Error ? error.message : 'Resource check failed'}`);
    process.exitCode = 1;
  });
}
