import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
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
  return result.stdout.trim();
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'autoworker-launch-'));
const socketPath = path.join(tmp, 'tmux.sock');
const worktree = path.join(tmp, 'repo');
await fs.mkdir(worktree, { recursive: true });
const realWorktree = await fs.realpath(worktree);

const env = {
  ...process.env,
  AUTOWORKER_TMUX_SOCKET: socketPath
};

try {
  const first = run('node', [path.join(process.cwd(), 'bin', 'autoworker.js')], {
    cwd: worktree,
    env
  });

  if (!first.includes('planner created') || !first.includes('worker created')) {
    throw new Error(`unexpected first launch output:\n${first}`);
  }

  const sessionsAfterFirst = run('tmux', ['-S', socketPath, 'list-sessions', '-F', '#{session_name}']);
  if (sessionsAfterFirst !== 'planner\nworker') {
    throw new Error(`unexpected sessions after first launch:\n${sessionsAfterFirst}`);
  }

  const plannerCwd = run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', 'planner:0.0', '#{pane_current_path}']);
  const workerCwd = run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', 'worker:0.0', '#{pane_current_path}']);
  if (plannerCwd !== realWorktree || workerCwd !== realWorktree) {
    throw new Error(`unexpected pane cwd:\nplanner=${plannerCwd}\nworker=${workerCwd}\nexpected=${realWorktree}`);
  }

  const second = run('node', [path.join(process.cwd(), 'bin', 'autoworker.js')], {
    cwd: worktree,
    env
  });

  if (!second.includes('planner reused') || !second.includes('worker reused')) {
    throw new Error(`unexpected second launch output:\n${second}`);
  }

  const sessionsAfterSecond = run('tmux', ['-S', socketPath, 'list-sessions', '-F', '#{session_name}']);
  if (sessionsAfterSecond !== 'planner\nworker') {
    throw new Error(`unexpected sessions after second launch:\n${sessionsAfterSecond}`);
  }

  console.log('launch smoke ok');
} finally {
  spawnSync('tmux', ['-S', socketPath, 'kill-server'], { encoding: 'utf8' });
  await fs.rm(tmp, { recursive: true, force: true });
}
