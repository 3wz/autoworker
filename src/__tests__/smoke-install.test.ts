import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'autoworker-smoke-'));
const codexHome = path.join(tmp, '.codex');
const binDir = path.join(tmp, 'bin');
await fs.mkdir(binDir, { recursive: true });
await fs.writeFile(path.join(binDir, 'omx'), '#!/usr/bin/env bash\necho omx-test\n');
await fs.chmod(path.join(binDir, 'omx'), 0o755);
const env = { ...process.env, CODEX_HOME: codexHome, PATH: `${binDir}:${process.env.PATH || ''}` };
const result = spawnSync('node', [path.join(process.cwd(), 'bin', 'autoworker.js'), 'setup'], { encoding: 'utf8', env });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status || 1);
for (const rel of ['skills/autoworker/SKILL.md', 'hooks.json']) {
  const full = path.join(codexHome, rel);
  await fs.access(full);
  console.log('verified', full);
}
