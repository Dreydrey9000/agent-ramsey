import test from 'node:test';
import assert from 'node:assert/strict';
import { watchDecision, watchOnce, readWatch } from '../watcher.mts';
import { launchPlist, verifyLoadedArguments } from '../onboarding.mts';
import { resourceAdvice } from '../advice.mts';
import type { Report } from '../monitor.mts';

test('healthy monitor stays quiet; repeated warning alerts with an hourly cooldown', () => {
  const now = 1900000000000;
  assert.equal(watchDecision(null, 'normal', now).notice, null);
  const first = watchDecision(null, 'warning', now);
  assert.equal(first.notice, null);
  const second = watchDecision(first, 'warning', now + 300000);
  assert.ok(second.notice);
  assert.equal(watchDecision(second, 'warning', now + 600000).notice, null);
  assert.ok(watchDecision(second, 'warning', now + 3900000).notice === null); // stale window restarts persistence
});
test('critical alerts immediately and unknown needs three readings', () => {
  const now = 1900000000000;
  assert.ok(watchDecision(null, 'critical', now).notice);
  const a = watchDecision(null, null, now);
  const b = watchDecision(a, 'nonsense', now + 300000);
  assert.equal(b.notice, null);
  assert.ok(watchDecision(b, null, now + 600000).notice);
});
test('sleep gaps and clock rollback cannot manufacture persistent pressure', () => {
  const first = watchDecision(null, 'warning', 1900000000000);
  assert.equal(watchDecision(first, 'warning', 1900001000000).consecutive, 1);
  assert.equal(watchDecision(first, 'warning', 1899999000000).consecutive, 1);
});
test('LaunchAgent escapes paths and is bounded, low priority, with no resident keepalive', () => {
  const plist = launchPlist('/opt/node', '/some/a&b/cli.mts', '/some/<state>');
  assert.match(plist, /a&amp;b/);
  assert.match(plist, /&lt;state&gt;/);
  assert.match(plist, /StartInterval<\/key><integer>300/);
  assert.doesNotMatch(plist, /KeepAlive|\/bin\/sh/);
  assert.throws(() => launchPlist('relative', '/cli', '/state'));
});
test('advice never treats high RSS or historical swap as reclaimable waste', () => {
  const r = { end: { memoryPressure: 'normal', swapUsedBytes: 99999999999 }, windowSeconds: 15, topCpu: [], topMemory: [{ rssGiB: 22 }] } as unknown as Report;
  const advice = resourceAdvice(r);
  assert.equal(advice.priority, 'healthy');
  assert.match(advice.protectedWork, /not wasted or reclaimable/);
  assert.match(advice.quicksilver.proof, /not proof of RAM savings/);
  assert.equal(resourceAdvice({ ...r, end: { ...r.end, memoryPressure: null } }).priority, 'measurement-unavailable');
});

test('critical escalation bypasses a warning cooldown', () => {
  const first = watchDecision(null, 'warning', 1900000000000);
  const warning = watchDecision(first, 'warning', 1900000300000);
  assert.ok(warning.notice);
  assert.ok(watchDecision(warning, 'critical', 1900000600000).notice);
});

import { mkdtempSync, writeFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LocalState } from '../state.mts';
test('a malformed private monitor state recovers to one bounded backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'ramsey-watch-'));
  try {
    chmodSync(root, 0o700);
    writeFileSync(join(root, 'watch.json'), '{broken', {mode: 0o600});
    const state = watchOnce(new LocalState(root), () => 'normal', () => '');
    assert.equal(state.pressure, 'normal');
    assert.ok(existsSync(join(root, 'watch-invalid.json')));
    assert.equal(readWatch(root)?.consecutive, 1);
    assert.equal(existsSync(join(root, 'watch.lock')), false);
    chmodSync(join(root, 'watch.json'), 0o644);
    assert.throws(() => watchOnce(new LocalState(root), () => 'normal', () => ''), /Unsafe/);
  } finally { rmSync(root, {recursive:true,force:true}); }
});
test('a loaded label is insufficient without this node, CLI and watch command', () => {
  assert.throws(() => verifyLoadedArguments('job loaded successfully'), /unexpected arguments/);
  verifyLoadedArguments(process.execPath + ' ' + resolve('cli.mts') + ' watch-once');
  assert.throws(() => verifyLoadedArguments(process.execPath + ' ' + resolve('cli.mts') + ' foreign-command'));
});
