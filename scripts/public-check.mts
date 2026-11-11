import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = readFileSync(join(root, 'PUBLIC-FILES.txt'), 'utf8').split('\n').filter(Boolean);
const allowed = new Set(names);
const patterns = [/\/(?:Users|home)\/[A-Za-z0-9_-]+\//, /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bsk-[A-Za-z0-9]{32,}/];
for (const name of names) {
  if (name.includes('..') || name.startsWith('/') || /(?:^|\/)(?:reports|state|node_modules)(?:\/|$)/.test(name)) throw new Error('Unsafe public-file path');
  const path = join(root, name);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error(`Invalid public file: ${name}`);
  const text = readFileSync(path, 'utf8');
  if (patterns.some(pattern => pattern.test(text))) throw new Error(`Private-path or credential pattern found in ${name}`);
}
let tracked: string[] = [];
try { tracked = execFileSync('/usr/bin/git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); }
catch { /* Exported source archives have no Git metadata. The manifest is still checked. */ }
for (const name of tracked) if (!allowed.has(name)) throw new Error(`Tracked file is outside the public allowlist: ${name}`);
console.log(`Public file check passed: ${names.length} allowlisted files, ${tracked.length} tracked files.`);
