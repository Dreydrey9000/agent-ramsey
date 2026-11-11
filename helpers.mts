import { createHash } from 'node:crypto';
import { appLabel, groupFor, type ProcessRow } from './monitor.mts';
import { readNative, type NativeReader } from './native.mts';
import type { ActiveWork } from './state.mts';

export type Listener = { pid: number; port: number };

export function parseListeners(output: string): Listener[] {
  const listeners = new Map<string, Listener>();
  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) {
      const match = line.match(/:(\d+)(?:\s|$)/);
      if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) {
        const port = Number(match[1]); listeners.set(`${pid}:${port}`, { pid, port });
      }
    }
  }
  return [...listeners.values()];
}

export function workFor(row: ProcessRow, rows: Map<number, ProcessRow>, work: ActiveWork[]): ActiveWork | undefined {
  let current: ProcessRow | undefined = row;
  const seen = new Set<number>();
  while (current && !seen.has(current.pid)) {
    seen.add(current.pid);
    const found = work.find(item => item.pid === current!.pid && item.started === current!.started);
    if (found) return found;
    current = rows.get(current.ppid);
  }
  return undefined;
}

export function annotateWork(rows: ProcessRow[], work: ActiveWork[]) {
  const map = new Map(rows.map(row => [row.pid, row]));
  const groups = new Map<string, { name: string; confirmedKinds: string[]; protected: true }>();
  for (const row of rows) {
    const found = workFor(row, map, work);
    if (!found) continue;
    const key = groupFor(row, map);
    const id = createHash('sha256').update(key).digest('hex').slice(0, 24);
    const group = groups.get(id) ?? { name: appLabel(key), confirmedKinds: [], protected: true };
    if (!group.confirmedKinds.includes(found.kind)) group.confirmedKinds.push(found.kind);
    groups.set(id, group);
  }
  return { confirmed: [...groups].map(([id, value]) => ({ id, ...value })),
    unknownWorkPolicy: 'Protected by default. No process is considered idle or safe to stop merely because it is absent from this registry.' };
}

export function findRepeatedHelpers(rows: ProcessRow[], listeners: Listener[], work: ActiveWork[]) {
  const map = new Map(rows.map(row => [row.pid, row]));
  const ports = new Map<number, number[]>();
  for (const item of listeners) ports.set(item.pid, [...new Set([...(ports.get(item.pid) ?? []), item.port])]);
  const groups = new Map<string, ProcessRow[]>();
  for (const row of rows) {
    const name = row.executable.split('/').pop() ?? '';
    const namedHelper = /mcp|language.server|typescript-language-server/i.test(name);
    const runtimeListener = /^(node|nodejs|python[\d.]*|bun|deno|ruby)$/i.test(name) && ports.has(row.pid);
    if (!namedHelper && !runtimeListener) continue;
    const owner = groupFor(row, map);
    const key = `${row.executable}\0${owner}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => {
    const owner = groupFor(group[0], map);
    return {
      executable: appLabel(group[0].executable), owner: appLabel(owner), count: group.length,
      ownerEvidence: owner.endsWith('.app') ? 'Observed app ancestry' : 'Executable only. An owning app was not established.',
      instances: group.slice(0, 20).map(row => ({ pid: row.pid, started: row.started,
        parentPid: row.ppid, listeningPorts: ports.get(row.pid) ?? [],
        workKind: workFor(row, map, work)?.kind ?? 'unknown', protected: true })),
      assessment: 'Possible repeated helpers, not confirmed duplicates. Distinct services or sessions can legitimately use the same executable.',
      nextStep: 'Inspect the owner and service purpose of one instance before considering cleanup. Nothing was stopped.',
    };
  }).sort((a, b) => b.count - a.count).slice(0, 12);
}

export function helperDiagnostics(rows: ProcessRow[], work: ActiveWork[], read: NativeReader = readNative) {
  let listeners: Listener[] = [];
  let listenerStatus = 'available';
  try { listeners = parseListeners(read('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'])); }
  catch (error) {
    const value = error as { status?: unknown; stdout?: unknown };
    if (value.status === 1 && String(value.stdout ?? '').trim() === '') listenerStatus = 'no accessible listeners';
    else listenerStatus = 'unavailable';
  }
  return { listenerStatus, candidates: findRepeatedHelpers(rows, listeners, work),
    note: 'Only accessible TCP listeners and executable names are inspected. Full command arguments, working directories, remote addresses and project contents are not read.' };
}
