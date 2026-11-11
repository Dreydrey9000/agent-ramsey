import { chmodSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let binDir = join(homedir(), '.local', 'bin');
let skillDir: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (!['--bin-dir', '--skill-dir'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node install.mts [--bin-dir PATH] [--skill-dir NEW_DIRECTORY]');
  const flag = args[i]; const value = resolve(args[++i]);
  if (flag === '--bin-dir') binDir = value;
  else skillDir = value;
}
if (skillDir && existsSync(skillDir)) throw new Error('Skill destination already exists. Choose a new directory to preserve existing instructions.');
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
mkdirSync(binDir, { recursive: true });
const wrapper = join(binDir, 'ramsey');
if (existsSync(wrapper)) throw new Error('Command destination already exists. Choose another --bin-dir or review the existing installation first.');
writeFileSync(wrapper, `#!/bin/sh\nset -eu\nexec ${shellQuote(process.execPath)} ${shellQuote(join(root, 'cli.mts'))} "$@"\n`, { flag: 'wx', mode: 0o755 });
chmodSync(wrapper, 0o755);
if (skillDir) {
  mkdirSync(skillDir, { recursive: true });
  copyFileSync(join(root, 'skills', 'ramsey', 'SKILL.md'), join(skillDir, 'SKILL.md'));
}
console.log(`Command installed: ${wrapper}`);
if (skillDir) console.log(`Skill installed: ${skillDir}`);
console.log('Keep this source checkout in place. No service or schedule was installed.');
