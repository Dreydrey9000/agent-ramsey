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
  const video = name === 'assets/ramsey-explainer.mp4';
  if (!info.isFile() || info.isSymbolicLink() || info.size > (video ? 25 : 1) * 1024 * 1024) throw new Error(`Invalid public file: ${name}`);
  const data = readFileSync(path);
  if (video && data.subarray(4, 8).toString('ascii') !== 'ftyp') throw new Error('Invalid MP4 signature');
  const font = /\.ttf$/.test(name);
  if (font && !data.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))) throw new Error('Invalid TrueType signature');
  const sound = /\.mp3$/.test(name);
  if (sound && data.subarray(0, 3).toString('ascii') !== 'ID3' && !(data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) throw new Error('Invalid MP3 signature');
  const raster = /\.(?:jpg|jpeg|png)$/i.test(name);
  if (raster) {
    const jpeg = /\.jpe?g$/i.test(name) && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const png = /\.png$/i.test(name) && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!jpeg && !png) throw new Error(`Raster signature does not match extension: ${name}`);
  }
  const text = data.toString(raster || video || font || sound ? 'latin1' : 'utf8');
  if (patterns.some(pattern => pattern.test(text))) throw new Error(`Private-path or credential pattern found in ${name}`);
}
let tracked: string[] = [];
try { tracked = execFileSync('/usr/bin/git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); }
catch { /* Exported source archives have no Git metadata. The manifest is still checked. */ }
for (const name of tracked) if (!allowed.has(name)) throw new Error(`Tracked file is outside the public allowlist: ${name}`);
console.log(`Public file check passed: ${names.length} allowlisted files, ${tracked.length} tracked files.`);
