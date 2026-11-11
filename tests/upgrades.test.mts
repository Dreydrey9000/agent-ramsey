import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, lstatSync, writeFileSync, symlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { energyDiagnostics, parseBattery, parseCpuIdle, thermalName } from '../energy.mts';
import { annotateWork, findRepeatedHelpers, parseListeners, workFor } from '../helpers.mts';
import { parseHeadroom, systemState, type ProcessRow, type Report } from '../monitor.mts';
import { assessCapacity } from '../preflight.mts';
import { compareEntries, LocalState, trends, validHistory, type ActiveWork, type HistoryEntry } from '../state.mts';
import { parseArgs } from '../cli.mts';

const GiB = 1073741824;
const row = (overrides: Partial<ProcessRow> = {}): ProcessRow => ({ pid: 10, ppid: 1, started: 'Wed Nov 11 12:32:14 2026',
  cpuSeconds: 10, rssKiB: 1024, executable: '/Applications/Example.app/Contents/MacOS/Example', ...overrides });
const failedRead = () => { throw new Error('Unavailable'); };
const system = () => ({ ...systemState(failedRead), totalMemoryBytes: 16 * GiB, headroomBytes: 8 * GiB, logicalCpus: 8, memoryPressure: 'normal' });
const energy = () => { const value = energyDiagnostics(failedRead); value.thermal.state = 'nominal'; return value; };
const entry = (time = 0, rssGiB = 1): HistoryEntry => ({ schema: 2, id: '00000000-0000-0000-0000-000000000001', installationId: '00000000-0000-0000-0000-000000000002',
  capturedAt: new Date(1794430000000 + time).toISOString(), workload: 'idle', samples: 3, interval: 5, windowSeconds: 15,
  totalMemoryBytes: 16 * GiB, pressure: 'normal', swapUsedBytes: 0, apps: [{ id: 'a'.repeat(24), name: 'Example', cpuPercent: 5, rssGiB }] });
const report = (): Report => ({ version: 1, capturedAt: new Date().toISOString(), windowSeconds: 5, start: system(), end: system(),
  topCpu: [{ id: 'a'.repeat(24), name: 'Example', cpuPercent: 20, peakCpuPercent: 25, busyIntervals: 0, measuredIntervals: 1, rssGiB: 1, processCount: 1, pids: [10] }],
  topMemory: [], limitations: [] });

test('battery power uses signed native current and rejects malformed sensors', () => {
  const value = parseBattery({ Voltage: '12000', InstantAmperage: '-2000', ExternalConnected: 'false', IsCharging: 'false', CurrentCapacity: '80' });
  assert.equal(value.batteryNetWatts, -24);
  assert.equal(value.direction, 'discharging');
  assert.equal(value.reportedChargePercent, 80);
  assert.equal(parseBattery({ Voltage: '12000', Amperage: '18446744073709549616' }).batteryNetWatts, -24);
  assert.equal(parseBattery({ Voltage: '999999', Amperage: '2' }).batteryNetWatts, null);
  assert.equal(parseBattery({ Voltage: '', Amperage: 'bad' }).batteryNetWatts, null);
  assert.equal(parseBattery({ CurrentCapacity: '7000' }).reportedChargePercent, null);
  assert.equal(parseBattery({ Voltage: '12000', Amperage: '1000', IsCharging: 'true', ExternalConnected: 'true' }).direction, 'charging');
});

test('energy extracts only allowlisted scalars and preserves unsupported sensors', () => {
  const result = energyDiagnostics((binary, args) => {
    if (binary.endsWith('ioreg')) return '<plist>private serial deliberately absent from output</plist>';
    if (binary.endsWith('plutil')) return ({ '0.Voltage': '12000', '0.Amperage': '-2000', '0.InstantAmperage': '-2000', '0.ExternalConnected': 'false', '0.IsCharging': 'false' } as Record<string, string>)[args[1]] ?? 'unknown';
    if (binary.endsWith('osascript')) return '{"thermalState":2,"lowPowerMode":true}';
    if (binary.endsWith('pmset')) return 'CPU_Speed_Limit = 80';
    throw new Error('Unexpected command');
  });
  assert.equal(result.thermal.state, 'serious');
  assert.equal(result.thermal.cpuSpeedLimitPercent, 80);
  assert.equal(result.lowPowerMode, true);
  assert.ok(!JSON.stringify(result).includes('private serial'));
  const missing = energyDiagnostics(failedRead);
  assert.equal(missing.battery.batteryNetWatts, null);
  assert.equal(missing.thermal.state, null);
  assert.equal(missing.thermal.temperatureCelsius, null);
  assert.equal(thermalName(4), null);
  assert.equal(thermalName(null), null);
});

test('CPU idle uses the last measured interval and rejects absent readings', () => {
  assert.equal(parseCpuIdle('CPU usage: 1% user, 1% sys, 98% idle\nCPU usage: 30% user, 20% sys, 50% idle'), 50);
  assert.throws(() => parseCpuIdle('unavailable'));
  assert.throws(() => parseCpuIdle('CPU usage: 0% user, 0% sys, 101% idle'));
});

test('headroom uses page size and only explicit available-page categories', () => {
  assert.equal(parseHeadroom('page size of 16384 bytes\nPages free: 10.\nPages speculative: 5.\nPages purgeable: 2.\nPages inactive: 9999.'), 17 * 16384);
  assert.throws(() => parseHeadroom('page size of 16384 bytes\nPages free: 10.'));
});

test('listener metadata drops addresses and deduplicates IPv4/IPv6 entries', () => {
  assert.deepEqual(parseListeners('p10\nn*:3000\nn[::1]:3000\np11\nn127.0.0.1:8080\nn*:99999'), [{ pid: 10, port: 3000 }, { pid: 11, port: 8080 }]);
  assert.deepEqual(parseListeners(''), []);
});

test('repeated helpers remain unconfirmed with observed ownership and protection', () => {
  const app = row();
  const one = row({ pid: 11, ppid: 10, executable: '/usr/bin/node' });
  const two = row({ pid: 12, ppid: 10, executable: '/usr/bin/node' });
  const result = findRepeatedHelpers([app, one, two], [{ pid: 11, port: 3000 }, { pid: 12, port: 4000 }], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].owner, 'Example');
  assert.match(result[0].assessment, /not confirmed duplicates/);
  assert.ok(result[0].instances.every(v => v.protected));
  assert.equal(findRepeatedHelpers([app, one, two], [], []).length, 0);
});

test('active work follows verified ancestry, with unknown work protected', () => {
  const app = row();
  const child = row({ pid: 11, ppid: 10, executable: '/usr/bin/node' });
  const work: ActiveWork[] = [{ pid: 10, started: app.started, kind: 'render', registeredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }];
  assert.equal(workFor(child, new Map([[10, app], [11, child]]), work)?.kind, 'render');
  assert.equal(workFor(child, new Map([[10, { ...app, started: 'reused' }], [11, child]]), work), undefined);
  assert.equal(annotateWork([app, child], work).confirmed[0].protected, true);
  assert.match(annotateWork([], []).unknownWorkPolicy, /Protected by default/);
});

test('comparisons require matching context and never invent absent app memory', () => {
  const a = entry(0, 1); const b = entry(20000, 1.5);
  assert.equal(compareEntries(a, b).changes[0].rssDeltaMiB, 512);
  for (const changed of [{ ...b, workload: 'unknown' as const }, { ...b, workload: 'render' as const }, { ...b, samples: 6 }, { ...b, installationId: 'other' }, { ...b, windowSeconds: 30 }]) {
    assert.equal(compareEntries(a, changed).comparable, false);
    assert.equal(compareEntries(a, changed).changes.length, 0);
  }
  assert.deepEqual(compareEntries(a, { ...b, apps: [] }).changes, []);
});

test('growing-memory hints require three comparable checks over enough time', () => {
  assert.equal(trends([entry(0, 1), entry(20000, 1.1), entry(40000, 1.2)]).length, 1);
  assert.equal(trends([entry(0, 1), entry(5000, 1.1), entry(10000, 1.2)]).length, 0);
  assert.equal(trends([entry(0, 1), entry(20000, 1.3), entry(40000, 1.2)]).length, 0);
  assert.equal(trends([entry(0, 1), entry(20000, 1.1)]).length, 0);
});

test('malformed persisted measurements cannot fabricate a zero baseline or comparable result', () => {
  const before = entry(); const after = entry(20000, 2);
  for (const changed of [
    { ...before, samples: undefined }, { ...before, interval: undefined }, { ...before, windowSeconds: undefined },
    { ...before, totalMemoryBytes: undefined }, { ...before, apps: [{ ...before.apps[0], rssGiB: null }] },
    { ...before, apps: [{ ...before.apps[0], cpuPercent: null }] }, { ...before, apps: [before.apps[0], before.apps[0]] },
    { ...before, apps: [{ ...before.apps[0], rssGiB: NaN }] },
  ]) {
    assert.equal(validHistory(changed), false);
    assert.equal(compareEntries(changed as HistoryEntry, after).comparable, false);
    assert.equal(compareEntries(changed as HistoryEntry, after).changes.length, 0);
  }
  assert.equal(compareEntries({ ...before, totalMemoryBytes: null }, { ...after, totalMemoryBytes: null }).comparable, false);
});

test('existing state and history directories must be private', t => {
  const root = mkdtempSync(join(tmpdir(), 'ramsey-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o777);
  assert.throws(() => new LocalState(root), /private/);
  chmodSync(root, 0o700);
  const state = new LocalState(root);
  mkdirSync(join(root, 'history'), { mode: 0o755 });
  assert.throws(() => state.history(), /private/);
});

test('concurrent retention pruning tolerates entries already removed by another check', { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'ramsey-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'history'), { mode: 0o700 });
  for (let i = 0; i < 1000; i++) {
    writeFileSync(join(root, 'history', `${String(i).padStart(13, '0')}-00000000-0000-0000-0000-000000000000.json`), '{}');
  }
  const code = `const {LocalState}=await import(process.argv[1]);const state=new LocalState(process.argv[2]);process.send('ready');process.once('message',()=>{try{process.send({ok:true,count:state.history().length});}catch(e){process.send({ok:false,error:e.message});}process.disconnect();});`;
  const workers = Array.from({ length: 2 }, () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, new URL('../state.mts', import.meta.url).href, root], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    return { child, ready: once(child, 'message') };
  });
  await Promise.all(workers.map(worker => worker.ready));
  const results = await Promise.all(workers.map(({ child }) => { const result = once(child, 'message'); child.send('go'); return result; }));
  for (const [result] of results) assert.deepEqual(result, { ok: true, count: 0 });
});

test('history stores selected measurements with private file permissions', t => {
  const root = mkdtempSync(join(tmpdir(), 'ramsey-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = new LocalState(root);
  state.record(report(), 'idle', 1, 5);
  const files = readdirSync(join(root, 'history'));
  assert.equal(files.length, 1);
  const path = join(root, 'history', files[0]);
  const text = readFileSync(path, 'utf8');
  assert.ok(!/"(pids|started|executable|localAiGuard)"/.test(text));
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.equal(state.history().length, 1);
  assert.equal(lstatSync(join(root, 'installation.json')).mode & 0o777, 0o600);
});

test('history prunes old entries, refuses malformed files and rejects symlink roots', t => {
  const root = mkdtempSync(join(tmpdir(), 'ramsey-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = new LocalState(join(root, 'state'));
  const old = report(); old.capturedAt = new Date(Date.now() - 15 * 86400000).toISOString();
  state.record(old, 'idle', 1, 5);
  assert.equal(state.history().length, 0);
  const file = join(root, 'state', 'history', `${Date.now()}-00000000-0000-0000-0000-000000000000.json`);
  writeFileSync(file, '{}');
  assert.throws(() => state.history(), /Invalid history/);
  mkdirSync(join(root, 'real')); symlinkSync(join(root, 'real'), join(root, 'link'));
  assert.throws(() => new LocalState(join(root, 'link')), /real directory/);
});

test('work registrations expire and never attach to reused process IDs', t => {
  const root = mkdtempSync(join(tmpdir(), 'ramsey-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = new LocalState(root); const processRow = row();
  state.protect(processRow, 'render', 1, [processRow]);
  assert.equal(state.work([processRow]).length, 1);
  assert.equal(state.work([{ ...processRow, started: 'new' }]).length, 0);
  assert.equal(state.work([processRow], Date.now() + 120000).length, 0);
  assert.throws(() => state.protect(processRow, 'render', 1441, [processRow]));
  assert.equal(state.unprotect(10, [processRow]).removed, 1);
});

test('preflight requires explicit budgets and keeps missing data unknown', () => {
  const budget = { memoryGiB: 2, cpuCores: 2, kind: 'render' as const };
  assert.equal(assessCapacity(system(), energy(), 80, budget).decision, 'go');
  assert.equal(assessCapacity(system(), energy(), 80, { ...budget, memoryGiB: null }).decision, 'unknown');
  assert.equal(assessCapacity({ ...system(), headroomBytes: 1 * GiB }, energy(), 80, budget).decision, 'unknown');
  assert.equal(assessCapacity(systemState(failedRead), energyDiagnostics(failedRead), null, budget).decision, 'unknown');
  assert.equal(assessCapacity(system(), energy(), 80, { ...budget, memoryGiB: NaN }).decision, 'unknown');
});

test('preflight waits on pressure, throttling, CPU shortage and disabled inference', () => {
  const budget = { memoryGiB: 2, cpuCores: 2, kind: 'render' as const };
  assert.equal(assessCapacity({ ...system(), memoryPressure: 'warning' }, energy(), 80, budget).decision, 'wait');
  const hot = energy(); hot.thermal.state = 'serious';
  assert.equal(assessCapacity(system(), hot, 80, budget).decision, 'wait');
  assert.equal(assessCapacity(system(), energy(), 10, budget).decision, 'wait');
  const guard = system(); guard.localAiGuard.disabledLatch = true;
  assert.equal(assessCapacity(guard, energy(), 80, { ...budget, kind: 'local-model' }).decision, 'wait');
  assert.notEqual(assessCapacity(system(), energy(), 80, { ...budget, kind: 'local-model' }).decision, 'go');
});

test('CLI enforces commands, option ownership, identity and budget bounds', () => {
  assert.equal(parseArgs(['check', '--workload', 'idle', '--no-history']).workload, 'idle');
  assert.equal(parseArgs(['protect', '--pid', '10', '--kind', 'render']).ttlMinutes, 120);
  assert.equal(parseArgs(['preflight', '--job', 'render', '--memory-gib', '2.5', '--cpu-cores', '1']).memoryGiB, 2.5);
  for (const args of [['history', '--samples', '2'], ['protect'], ['protect', '--pid', '10'], ['unprotect', '--pid', '-1'], ['preflight', '--memory-gib', 'NaN'], ['preflight', '--cpu-cores', 'Infinity'], ['check', '--workload', 'private arbitrary text'], ['watch'], ['kill']]) assert.throws(() => parseArgs(args));
});
