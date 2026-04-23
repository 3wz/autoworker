import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function run(command: string, args: string[], options: Parameters<typeof spawnSync>[2] = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `command failed: ${command} ${args.join(' ')}`,
        result.stdout,
        result.stderr
      ].filter(Boolean).join('\n')
    );
  }
  return String(result.stdout).trim();
}

export function runAllowFailure(command: string, args: string[], options: Parameters<typeof spawnSync>[2] = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function installFakeCodex(binDir: string) {
  const codexPath = path.join(binDir, 'codex');
  const script = `#!/usr/bin/env bash
set -euo pipefail
state_file="\${AUTOWORKER_FAKE_CODEX_STATE:-}"
if [[ -n "$state_file" ]]; then
  mkdir -p "$(dirname "$state_file")"
  printf '%s\\n' "$*" >> "$state_file"
fi
echo "OpenAI Codex"
if [[ "\${1:-}" == "exec" && "\${2:-}" == "resume" ]]; then
  echo "submitted to session \${3:-}"
  exit 0
fi
if [[ "\${1:-}" == "resume" ]]; then
  echo "resuming session \${2:-}"
  exit 0
fi
echo "starting codex"
exit 0
`;
  await fs.writeFile(codexPath, script);
  await fs.chmod(codexPath, 0o755);
}
