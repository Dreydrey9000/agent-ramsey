import { execFileSync } from 'node:child_process';

export type NativeReader = (binary: string, args: string[], input?: string) => string;

export const readNative: NativeReader = (binary, args, input) => execFileSync(binary, args, {
  encoding: 'utf8', input, timeout: 8000, maxBuffer: 8 * 1024 * 1024,
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

export function optional<T>(read: () => T): T | null {
  try { return read(); } catch { return null; }
}
