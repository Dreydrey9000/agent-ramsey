import test from 'node:test';
import assert from 'node:assert/strict';
import { appLabel, cpuSeconds, parseCompressed, parseProcesses, parseSwap, pressureName, summarize, systemState, type ProcessRow } from '../monitor.mts';
import { parseArgs } from '../cli.mts';

const row = (overrides: Partial<ProcessRow> = {}): ProcessRow => ({
  pid: 10, ppid: 1, started: 'Wed Nov 11 12:32:14 2026', cpuSeconds: 10,
  rssKiB: 1048576, executable: '/Applications/Example.app/Contents/MacOS/Example', ...overrides,
});

test('parses macOS CPU time including fractions, hours and days', () => {
  assert.equal(cpuSeconds('2:28.81'), 148.81);
  assert.equal(cpuSeconds('01:02:03.5'), 3723.5);
  assert.equal(cpuSeconds('2-01:02:03'), 176523);
  assert.throws(() => cpuSeconds('unavailable'));
});

test('process parser preserves executable spaces but fails on changed output', () => {
  const output = ' 10 1 Wed Nov 11 12:32:14 2026 2:28.81 1048576 /Applications/Some App.app/Contents/MacOS/Some App';
  const [parsed] = parseProcesses(output);
  assert.equal(parsed.pid, 10);
  assert.equal(parsed.executable, '/Applications/Some App.app/Contents/MacOS/Some App');
  assert.throws(() => parseProcesses('unexpected process output'));
  assert.throws(() => parseProcesses('   \n'));
});

test('aggregates app helpers and descendants with measured CPU deltas', () => {
  const a = row();
  const b = row({ pid: 11, ppid: 10, executable: '/usr/local/bin/node' });
  const apps = summarize([
    { at: 0, processes: [a, b] },
    { at: 5000, processes: [row({ cpuSeconds: 15 }), { ...b, cpuSeconds: 15 }] },
  ]);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].cpuPercent, 200);
  assert.equal(apps[0].rssGiB, 2);
  assert.equal(apps[0].processCount, 2);
});

test('CPU averages use real elapsed time and distinguish spikes', () => {
  const apps = summarize([
    { at: 0, processes: [row()] },
    { at: 1000, processes: [row({ cpuSeconds: 11 })] },
    { at: 10000, processes: [row({ cpuSeconds: 11 })] },
  ]);
  assert.equal(apps[0].cpuPercent, 10);
  assert.equal(apps[0].peakCpuPercent, 100);
  assert.equal(apps[0].busyIntervals, 1);
});

test('PID reuse, counter resets and new processes cannot invent CPU load', () => {
  const apps = summarize([
    { at: 0, processes: [row({ cpuSeconds: 100 })] },
    { at: 1000, processes: [row({ started: 'new process', cpuSeconds: 999 }), row({ pid: 11, cpuSeconds: 9000 })] },
  ]);
  assert.equal(apps[0].cpuPercent, 0);
  const reset = summarize([{ at: 0, processes: [row()] }, { at: 1000, processes: [row({ cpuSeconds: 1 })] }]);
  assert.equal(reset[0].cpuPercent, 0);
});

test('exited apps have zero current RSS and missing intervals count as zero', () => {
  const apps = summarize([
    { at: 0, processes: [row()] },
    { at: 1000, processes: [row({ cpuSeconds: 11 })] },
    { at: 2000, processes: [] },
  ]);
  assert.equal(apps[0].cpuPercent, 50);
  assert.equal(apps[0].rssGiB, 0);
  assert.equal(apps[0].processCount, 0);
});

test('parent cycles terminate and labels omit paths and terminal controls', () => {
  const apps = summarize([
    { at: 0, processes: [row({ ppid: 10, executable: '/usr/bin/tool' })] },
    { at: 1000, processes: [row({ ppid: 10, executable: '/usr/bin/tool', cpuSeconds: 11 })] },
  ]);
  assert.equal(apps[0].name, 'tool');
  assert.equal(appLabel('/private/name\u001b.app'), 'name');
});

test('system parsers preserve units and unknown pressure states', () => {
  assert.equal(parseSwap('total = 2.00G used = 1.50G free = 0.50G'), 1.5 * 1073741824);
  assert.equal(parseSwap('used = 512.00M'), 512 * 1048576);
  assert.equal(parseCompressed('page size of 16384 bytes\nPages occupied by compressor: 100.'), 1638400);
  assert.equal(pressureName(1), 'normal');
  assert.equal(pressureName(2), 'warning');
  assert.equal(pressureName(4), 'critical');
  assert.equal(pressureName(99), 'unknown');
  assert.throws(() => parseSwap('broken'));
  assert.throws(() => parseCompressed('broken'));
});

test('CLI bounds prevent unbounded monitoring and reject invalid inputs', () => {
  assert.equal(parseArgs([]).command, 'check');
  assert.equal(parseArgs([]).samples, 3);
  assert.equal(parseArgs([]).interval, 5);
  assert.equal(parseArgs(['--samples', '6', '--interval', '5', '--json']).samples, 6);
  for (const args of [['--samples', '0'], ['--samples', '13'], ['--interval', '11'], ['--interval'], ['--samples', 'NaN'], ['--interval', '1.5'], ['--kill']]) {
    assert.throws(() => parseArgs(args));
  }
  assert.throws(() => summarize([{ at: 0, processes: [] }]));
  assert.throws(() => summarize([{ at: 0, processes: [] }, { at: 0, processes: [] }]));
});

test('missing and empty system readings stay unavailable, never reassuring zeros', () => {
  for (const read of [() => '', () => { throw new Error('Permission denied'); }]) {
    const state = systemState(read);
    assert.equal(state.totalMemoryBytes, null);
    assert.equal(state.logicalCpus, null);
    assert.equal(state.memoryPressure, null);
    assert.equal(state.swapUsedBytes, null);
    assert.equal(state.compressedBytes, null);
    assert.equal(state.battery, null);
    assert.equal(state.headroomBytes, null);
    assert.equal(state.unavailable.length, 7);
    assert.equal(state.energyWatts, null);
  }
});
