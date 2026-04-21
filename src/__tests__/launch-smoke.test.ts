import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { installFakeCodex, expect, run, runAllowFailure } from '../testing/helpers.js';

async function waitForPaneBoot(socketPath: string, paneId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const command = run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', paneId, '#{pane_current_command}']);
    const capture = run('tmux', ['-S', socketPath, 'capture-pane', '-p', '-t', paneId, '-S', '-20']);
    const normalized = capture.replace(/\r/g, '');

    if (command === 'bash' && normalized.includes('OpenAI Codex')) {
      return { command, capture: normalized };
    }
    if (
      normalized.includes('resuming session') ||
      normalized.includes('OpenAI Codex') ||
      normalized.includes('starting codex')
    ) {
      return { command, capture: normalized };
    }
    if (
      !normalized.includes('AUTOWORKER_ROLE=') &&
      !normalized.includes('codex resume ') &&
      !normalized.includes('AUTOWORKER_THREAD_NAME=') &&
      !normalized.includes('sh -lc')
    ) {
      return { command, capture: normalized };
    }
    await delay(250);
  }
  const command = run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', paneId, '#{pane_current_command}']);
  const capture = run('tmux', ['-S', socketPath, 'capture-pane', '-p', '-t', paneId, '-S', '-20']).replace(/\r/g, '');
  throw new Error(`pane did not boot codex in time:\npane=${paneId}\ncommand=${command}\n${capture}`);
}

function repoSessionName(cwd: string) {
  return path.basename(cwd);
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'autoworker-launch-'));
const socketPath = path.join(tmp, 'tmux.sock');
const workspaceRoot = path.join(tmp, 'workspace');
const binDir = path.join(tmp, 'bin');
const fakeCodexState = path.join(tmp, 'fake-codex.log');
const worktree = path.join(workspaceRoot, 'app-main');
const otherWorktree = path.join(workspaceRoot, 'other-repo');
const conflictingWorktree = path.join(workspaceRoot, 'shadow', 'app-main');
await fs.mkdir(worktree, { recursive: true });
await fs.mkdir(otherWorktree, { recursive: true });
await fs.mkdir(conflictingWorktree, { recursive: true });
await fs.mkdir(binDir, { recursive: true });
await installFakeCodex(binDir);
const fakeCodexPath = path.join(binDir, 'codex');
const realWorktree = await fs.realpath(worktree);
const realOtherWorktree = await fs.realpath(otherWorktree);
const realConflictingWorktree = await fs.realpath(conflictingWorktree);
const sessionName = repoSessionName(realWorktree);
const plannerThread = `${path.basename(realWorktree)}-planner`;
const workerThread = `${path.basename(realWorktree)}-worker`;

const env = {
  ...process.env,
  AUTOWORKER_TMUX_SOCKET: socketPath,
  AUTOWORKER_DISABLE_ATTACH: '1',
  AUTOWORKER_FAKE_CODEX_STATE: fakeCodexState,
  AUTOWORKER_CODEX_BIN: fakeCodexPath,
  PATH: `${binDir}:${process.env.PATH || ''}`
};

try {
  const help = run('node', [path.join(process.cwd(), 'bin', 'autoworker.js'), '--help'], {
    cwd: worktree,
    env
  });
  expect(help.includes('Usage:'), `unexpected help output:\n${help}`);
  const noSessionsAfterHelp = runAllowFailure('tmux', ['-S', socketPath, 'list-sessions', '-F', '#{session_name}']);
  expect(noSessionsAfterHelp.status !== 0, 'help should not create tmux sessions');

  const unknown = runAllowFailure('node', [path.join(process.cwd(), 'bin', 'autoworker.js'), 'unknown'], {
    cwd: worktree,
    env
  });
  expect(unknown.status !== 0, 'unknown command should fail');
  expect((unknown.stderr || '').includes('Unknown command: unknown'), `unexpected unknown stderr:\n${unknown.stderr}`);
  const noSessionsAfterUnknown = runAllowFailure('tmux', ['-S', socketPath, 'list-sessions', '-F', '#{session_name}']);
  expect(noSessionsAfterUnknown.status !== 0, 'unknown command should not create tmux sessions');

  run('tmux', ['-S', socketPath, 'new-session', '-d', '-s', 'bootstrap', '-c', realOtherWorktree]);
  run('tmux', ['-S', socketPath, 'set-environment', '-g', 'PATH', env.PATH || '']);
  run('tmux', ['-S', socketPath, 'set-environment', '-g', 'AUTOWORKER_FAKE_CODEX_STATE', fakeCodexState]);
  run('tmux', ['-S', socketPath, 'new-session', '-d', '-s', 'repo', '-c', realOtherWorktree]);

  const first = run('node', [path.join(process.cwd(), 'bin', 'autoworker.js')], {
    cwd: worktree,
    env
  });

  expect(first.includes(`${sessionName} created`), `unexpected first launch output:\n${first}`);
  expect(first.includes(`planner_thread=${plannerThread}`), `missing planner thread line:\n${first}`);
  expect(first.includes(`worker_thread=${workerThread}`), `missing worker thread line:\n${first}`);
  expect(first.includes(`codex_bin=${fakeCodexPath}`), `missing codex bin line:\n${first}`);

  const sessionsAfterFirst = run('tmux', ['-S', socketPath, 'list-sessions', '-F', '#{session_name}']);
  expect(sessionsAfterFirst.includes(sessionName), `session missing:\n${sessionsAfterFirst}`);

  const repoRoot = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_REPO_ROOT']);
  expect(repoRoot === `AUTOWORKER_REPO_ROOT=${realWorktree}`, `unexpected repo root:\n${repoRoot}`);
  const mouseOption = run('tmux', ['-S', socketPath, 'show-options', '-t', sessionName, '-v', 'mouse']);
  expect(mouseOption === 'on', `mouse should be enabled for autoworker session:\n${mouseOption}`);

  const plannerPaneId = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_PLANNER_PANE']).replace('AUTOWORKER_PLANNER_PANE=', '');
  const workerPaneId = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_WORKER_PANE']).replace('AUTOWORKER_WORKER_PANE=', '');
  expect(plannerPaneId && workerPaneId && plannerPaneId !== workerPaneId, `unexpected pane ids:\nplanner=${plannerPaneId}\nworker=${workerPaneId}`);

  const paneTitles = run('tmux', ['-S', socketPath, 'list-panes', '-t', sessionName, '-F', '#{pane_id} #{pane_title} #{pane_current_path}']);
  expect(paneTitles.includes(`${plannerPaneId} autoworker:planner ${realWorktree}`), `planner pane missing:\n${paneTitles}`);
  expect(paneTitles.includes(`${workerPaneId} autoworker:worker ${realWorktree}`), `worker pane missing:\n${paneTitles}`);

  const activePaneId = run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', sessionName, '#{window_active} #{pane_id}']);
  expect(activePaneId.endsWith(plannerPaneId), `planner should be active:\n${activePaneId}`);

  const plannerBoot = await waitForPaneBoot(socketPath, plannerPaneId);
  const workerBoot = await waitForPaneBoot(socketPath, workerPaneId);
  expect(plannerBoot.capture.includes('OpenAI Codex'), `planner pane did not show fake codex:\n${plannerBoot.capture}`);
  expect(workerBoot.capture.includes('OpenAI Codex'), `worker pane did not show fake codex:\n${workerBoot.capture}`);
  expect(plannerBoot.capture.includes(`resuming session ${plannerThread}`), `planner pane did not resume fake codex thread:\n${plannerBoot.capture}`);
  expect(workerBoot.capture.includes(`resuming session ${workerThread}`), `worker pane did not resume fake codex thread:\n${workerBoot.capture}`);

  const fakeCodexLog = await fs.readFile(fakeCodexState, 'utf8');
  expect(fakeCodexLog.includes(`resume ${plannerThread} --no-alt-screen`), `planner resume not recorded:\n${fakeCodexLog}`);
  expect(fakeCodexLog.includes(`resume ${workerThread} --no-alt-screen`), `worker resume not recorded:\n${fakeCodexLog}`);

  const second = run('node', [path.join(process.cwd(), 'bin', 'autoworker.js')], {
    cwd: worktree,
    env
  });
  expect(second.includes(`${sessionName} reused`), `unexpected second launch output:\n${second}`);
  expect(
    second.includes(`enter session=${sessionName} planner_pane=${plannerPaneId} mode=attach`) ||
    second.includes(`enter session=${sessionName} planner_pane=${plannerPaneId} mode=switch`),
    `missing enter line:\n${second}`
  );

  const panesAfterSecond = run('tmux', ['-S', socketPath, 'list-panes', '-t', sessionName, '-F', '#{pane_id} #{pane_title}']);
  const plannerCount = panesAfterSecond.split('\n').filter((line: string) => line.includes('autoworker:planner')).length;
  const workerCount = panesAfterSecond.split('\n').filter((line: string) => line.includes('autoworker:worker')).length;
  expect(plannerCount === 1, `unexpected planner pane count:\n${panesAfterSecond}`);
  expect(workerCount === 1, `unexpected worker pane count:\n${panesAfterSecond}`);

  const conflict = runAllowFailure('node', [path.join(process.cwd(), 'bin', 'autoworker.js')], {
    cwd: conflictingWorktree,
    env
  });
  expect(conflict.status !== 0, 'conflicting repo should fail');
  expect((conflict.stderr || '').includes(`tmux session ${sessionName} belongs to another directory`), `unexpected conflict stderr:\n${conflict.stderr}`);
  expect((conflict.stderr || '').includes(realConflictingWorktree) === false, `conflict should point at existing repo root:\n${conflict.stderr}`);

  console.log('launch smoke ok');
} finally {
  runAllowFailure('tmux', ['-S', socketPath, 'kill-server'], { encoding: 'utf8' });
  await fs.rm(tmp, { recursive: true, force: true });
}
