import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
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
  expect(first.includes('supervision=armed'), `missing supervision line:\n${first}`);

  const sessionsAfterFirst = run('tmux', ['-S', socketPath, 'list-sessions', '-F', '#{session_name}']);
  expect(sessionsAfterFirst.includes(sessionName), `session missing:\n${sessionsAfterFirst}`);

  const repoRoot = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_REPO_ROOT']);
  expect(repoRoot === `AUTOWORKER_REPO_ROOT=${realWorktree}`, `unexpected repo root:\n${repoRoot}`);
  const statePathLine = first.split('\n').find((line) => line.startsWith('state_path='));
  expect(statePathLine, `missing state path line:\n${first}`);
  const statePath = statePathLine.slice('state_path='.length);
  expect(statePath.includes(`${path.sep}.autoworker${path.sep}state${path.sep}autoworker-state.json`), `state should live under .autoworker:\n${statePath}`);
  const legacyOmxStatePath = path.join(realWorktree, '.omx', 'state', 'autoworker-state.json');
  const legacyOmxState = await fs.stat(legacyOmxStatePath).catch(() => undefined);
  expect(!legacyOmxState, `runtime state must not be written under .omx:\n${legacyOmxStatePath}`);
  const runtimeStateRaw = await fs.readFile(statePath, 'utf8');
  const runtimeState = JSON.parse(runtimeStateRaw) as Record<string, unknown>;
  expect(runtimeState.repo === realWorktree, `unexpected runtime repo:\n${runtimeStateRaw}`);
  expect(runtimeState.tmux_session === sessionName, `unexpected runtime session:\n${runtimeStateRaw}`);
  expect(runtimeState.tmux_socket_path === socketPath, `unexpected runtime socket:\n${runtimeStateRaw}`);
  expect(runtimeState.planner_pane, `planner pane missing in state:\n${runtimeStateRaw}`);
  expect(runtimeState.worker_pane, `worker pane missing in state:\n${runtimeStateRaw}`);
  expect(runtimeState.watcher_pid, `watcher pid missing in state:\n${runtimeStateRaw}`);
  process.kill(Number(runtimeState.watcher_pid), 0);
  const mouseOption = run('tmux', ['-S', socketPath, 'show-options', '-t', sessionName, '-v', 'mouse']);
  expect(mouseOption === 'on', `mouse should be enabled for autoworker session:\n${mouseOption}`);

  const plannerPaneId = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_PLANNER_PANE']).replace('AUTOWORKER_PLANNER_PANE=', '');
  const workerPaneId = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_WORKER_PANE']).replace('AUTOWORKER_WORKER_PANE=', '');
  expect(plannerPaneId && workerPaneId && plannerPaneId !== workerPaneId, `unexpected pane ids:\nplanner=${plannerPaneId}\nworker=${workerPaneId}`);

  const paneTitles = run('tmux', ['-S', socketPath, 'list-panes', '-t', sessionName, '-F', '#{pane_id} #{pane_title} #{pane_current_path}']);
  expect(paneTitles.includes(`${plannerPaneId} autoworker:planner ${realWorktree}`), `planner pane missing:\n${paneTitles}`);
  expect(paneTitles.includes(`${workerPaneId} autoworker:worker ${realWorktree}`), `worker pane missing:\n${paneTitles}`);
  const plannerLeft = Number(run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', plannerPaneId, '#{pane_left}']));
  const workerLeft = Number(run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', workerPaneId, '#{pane_left}']));
  expect(plannerLeft < workerLeft, `planner must be left of worker:\nplanner=${plannerPaneId}@${plannerLeft} worker=${workerPaneId}@${workerLeft}`);

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
  run('python3', ['assets/skill-autoworker/scripts/omx-stop-wrapper.py'], {
    cwd: process.cwd(),
    env: {
      ...env,
      TMUX: `${socketPath},123,0`,
      TMUX_PANE: workerPaneId
    },
    input: JSON.stringify({ cwd: realWorktree })
  });
  await delay(400);
  const plannerInboxDir = path.join(realWorktree, '.autoworker', 'inbox', 'planner');
  const plannerInboxFiles = (await fs.readdir(plannerInboxDir)).filter((name) => name.endsWith('.json'));
  expect(plannerInboxFiles.length > 0, `planner inbox event missing:\n${plannerInboxDir}`);
  const updatedStateRaw = await fs.readFile(statePath, 'utf8');
  const updatedState = JSON.parse(updatedStateRaw) as Record<string, unknown>;
  expect(
    String(updatedState.last_reason || '').includes(':inbox') &&
    updatedState.pending_supervisor_action === true,
    `worker stop hook did not enqueue planner inbox event:\n${updatedStateRaw}`
  );
  const hookOutput = run('python3', ['assets/skill-autoworker/scripts/autoworker.py', 'hook', '--cwd', realWorktree], {
    cwd: process.cwd(),
    env: {
      ...env,
      TMUX: `${socketPath},123,0`,
      TMUX_PANE: plannerPaneId
    }
  });
  await delay(200);
  const processedInboxDir = path.join(plannerInboxDir, 'processed');
  const processedFiles = (await fs.readdir(processedInboxDir)).filter((name) => name.endsWith('.json'));
  expect(processedFiles.length > 0, `planner inbox event was not processed:\n${processedInboxDir}`);
  expect(hookOutput.includes('$autoworker AUTOWORKER_EVENT'), `planner hook did not surface inbox event:\n${hookOutput}`);

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

  run('tmux', ['-S', socketPath, 'kill-session', '-t', sessionName]);
  run('tmux', ['-S', socketPath, 'new-session', '-d', '-s', sessionName, '-c', realWorktree]);
  const oldPlannerPane = run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', `${sessionName}:0.0`, '#{pane_id}']);
  const oldWorkerPane = run('tmux', ['-S', socketPath, 'split-window', '-t', `${sessionName}:0.0`, '-h', '-c', realWorktree, '-P', '-F', '#{pane_id}']);
  run('tmux', ['-S', socketPath, 'select-pane', '-t', oldPlannerPane, '-T', 'autoworker:planner']);
  run('tmux', ['-S', socketPath, 'select-pane', '-t', oldWorkerPane, '-T', 'autoworker:worker']);
  run('tmux', ['-S', socketPath, 'set-option', '-t', sessionName, 'mouse', 'off']);
  run('tmux', ['-S', socketPath, 'set-environment', '-t', sessionName, '-u', 'AUTOWORKER_REPO_ROOT']);
  run('tmux', ['-S', socketPath, 'set-environment', '-t', sessionName, '-u', 'AUTOWORKER_PLANNER_PANE']);
  run('tmux', ['-S', socketPath, 'set-environment', '-t', sessionName, '-u', 'AUTOWORKER_WORKER_PANE']);
  await fs.rm(path.join(realWorktree, '.autoworker'), { recursive: true, force: true });

  const healed = run('node', [path.join(process.cwd(), 'bin', 'autoworker.js')], {
    cwd: worktree,
    env
  });
  expect(healed.includes(`${sessionName} reused`), `legacy session should be reused:\n${healed}`);
  const healedRepoRoot = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_REPO_ROOT']);
  const healedPlannerPane = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_PLANNER_PANE']).replace('AUTOWORKER_PLANNER_PANE=', '');
  const healedWorkerPane = run('tmux', ['-S', socketPath, 'show-environment', '-t', sessionName, 'AUTOWORKER_WORKER_PANE']).replace('AUTOWORKER_WORKER_PANE=', '');
  expect(healedRepoRoot === `AUTOWORKER_REPO_ROOT=${realWorktree}`, `repo root was not repaired:\n${healedRepoRoot}`);
  expect(healedPlannerPane === oldPlannerPane, `planner pane was not repaired:\n${healedPlannerPane}`);
  expect(healedWorkerPane === oldWorkerPane, `worker pane was not repaired:\n${healedWorkerPane}`);
  const healedPlannerLeft = Number(run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', healedPlannerPane, '#{pane_left}']));
  const healedWorkerLeft = Number(run('tmux', ['-S', socketPath, 'display-message', '-p', '-t', healedWorkerPane, '#{pane_left}']));
  expect(healedPlannerLeft < healedWorkerLeft, `healed planner must be left of worker:\nplanner=${healedPlannerPane}@${healedPlannerLeft} worker=${healedWorkerPane}@${healedWorkerLeft}`);
  const healedStatePath = path.join(realWorktree, '.autoworker', 'state', 'autoworker-state.json');
  const healedStateRaw = await fs.readFile(healedStatePath, 'utf8');
  const healedState = JSON.parse(healedStateRaw) as Record<string, unknown>;
  expect(healedState.watcher_pid, `watcher pid missing after healing:\n${healedStateRaw}`);
  process.kill(Number(healedState.watcher_pid), 0);
  run('python3', ['assets/skill-autoworker/scripts/omx-stop-wrapper.py'], {
    cwd: process.cwd(),
    env: {
      ...env,
      TMUX: `${socketPath},123,0`,
      TMUX_PANE: healedWorkerPane
    },
    input: JSON.stringify({ cwd: realWorktree })
  });
  await delay(400);
  const healedInboxDir = path.join(realWorktree, '.autoworker', 'inbox', 'planner');
  const healedInboxFiles = (await fs.readdir(healedInboxDir)).filter((name) => name.endsWith('.json'));
  expect(healedInboxFiles.length > 0, `healed planner inbox event missing:\n${healedInboxDir}`);
  const healedUpdatedStateRaw = await fs.readFile(healedStatePath, 'utf8');
  const healedUpdatedState = JSON.parse(healedUpdatedStateRaw) as Record<string, unknown>;
  expect(
    String(healedUpdatedState.last_reason || '').includes(':inbox') &&
    healedUpdatedState.pending_supervisor_action === true,
    `healed worker stop hook did not enqueue planner inbox event:\n${healedUpdatedStateRaw}`
  );
  const healedHookOutput = run('python3', ['assets/skill-autoworker/scripts/autoworker.py', 'hook', '--cwd', realWorktree], {
    cwd: process.cwd(),
    env: {
      ...env,
      TMUX: `${socketPath},123,0`,
      TMUX_PANE: healedPlannerPane
    }
  });
  await delay(200);
  const healedProcessedDir = path.join(healedInboxDir, 'processed');
  const healedProcessedFiles = (await fs.readdir(healedProcessedDir)).filter((name) => name.endsWith('.json'));
  expect(healedProcessedFiles.length > 0, `healed planner inbox event was not processed:\n${healedProcessedDir}`);
  expect(healedHookOutput.includes('$autoworker AUTOWORKER_EVENT'), `healed planner hook did not surface inbox event:\n${healedHookOutput}`);

  console.log('launch smoke ok');
} finally {
  runAllowFailure('tmux', ['-S', socketPath, 'kill-server'], { encoding: 'utf8' });
  await fs.rm(tmp, { recursive: true, force: true });
}
