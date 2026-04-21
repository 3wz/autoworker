import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, run } from '../testing/helpers.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'autoworker-wrapper-'));
const socketPath = path.join(tmp, 'tmux.sock');
const worktree = path.join(tmp, 'repo');
await fs.mkdir(worktree, { recursive: true });
const realWorktree = await fs.realpath(worktree);

try {
  const sessionName = path.basename(realWorktree);
  run('tmux', ['-S', socketPath, 'new-session', '-d', '-s', sessionName, '-c', realWorktree]);
  const plannerPane = run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', `${sessionName}:0.0`, '#{pane_id}']);
  const workerPane = run('tmux', ['-S', socketPath, 'split-window', '-t', `${sessionName}:0.0`, '-h', '-c', realWorktree, '-P', '-F', '#{pane_id}']);
  run('tmux', ['-S', socketPath, 'select-pane', '-t', plannerPane, '-T', 'autoworker:planner']);
  run('tmux', ['-S', socketPath, 'select-pane', '-t', workerPane, '-T', 'autoworker:worker']);
  run('tmux', ['-S', socketPath, 'set-environment', '-t', sessionName, 'AUTOWORKER_REPO_ROOT', realWorktree]);
  run('tmux', ['-S', socketPath, 'set-environment', '-t', sessionName, 'AUTOWORKER_PLANNER_PANE', plannerPane]);
  run('tmux', ['-S', socketPath, 'set-environment', '-t', sessionName, 'AUTOWORKER_WORKER_PANE', workerPane]);

  const payload = JSON.stringify({ cwd: realWorktree });
  const plannerEnv = {
    ...process.env,
    TMUX: `${socketPath},123,0`,
    TMUX_PANE: plannerPane
  };
  const plannerResult = spawnSync('python3', ['assets/skill-autoworker/scripts/omx-stop-wrapper.py'], {
    cwd: process.cwd(),
    env: plannerEnv,
    input: payload,
    encoding: 'utf8'
  });
  expect(plannerResult.status === 0, `planner wrapper failed:\n${plannerResult.stdout}\n${plannerResult.stderr}`);
  const plannerDecision = JSON.parse((plannerResult.stdout || '').trim()) as { decision: string };
  expect(plannerDecision.decision === 'allow', `planner should allow:\n${plannerResult.stdout}`);

  const workerEnv = {
    ...process.env,
    TMUX: `${socketPath},123,0`,
    TMUX_PANE: workerPane
  };
  const workerResult = spawnSync('python3', ['assets/skill-autoworker/scripts/omx-stop-wrapper.py'], {
    cwd: process.cwd(),
    env: workerEnv,
    input: payload,
    encoding: 'utf8'
  });
  expect(workerResult.status === 0, `worker wrapper failed:\n${workerResult.stdout}\n${workerResult.stderr}`);
  expect((workerResult.stdout || '').trim() !== JSON.stringify({ decision: 'allow' }), `worker should not allow:\n${workerResult.stdout}`);

  console.log('stop wrapper smoke ok');
} finally {
  spawnSync('tmux', ['-S', socketPath, 'kill-server'], { encoding: 'utf8' });
  await fs.rm(tmp, { recursive: true, force: true });
}
