import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

type HookCommand = {
  type: 'command';
  command: string;
  statusMessage?: string;
  timeout?: number;
};

type HookEntry = {
  hooks?: HookCommand[];
};

type HooksFile = {
  hooks?: Record<string, HookEntry[]>;
};

type CodexCandidate = {
  path: string;
  version?: string;
  source: string;
};

export function codexHomeFromArgs(args: string[] = []) {
  const idx = args.indexOf('--codex-home');
  if (idx >= 0 && args[idx + 1]) return path.resolve(args[idx + 1]);
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function assetPath(...parts: string[]) {
  return path.join(ROOT, 'assets', ...parts);
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function copyDir(src: string, dest: string) {
  await ensureDir(path.dirname(dest));
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true });
}

export async function readJsonIfExists<T = unknown>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function writeJson(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function commandOk(command: string, args: string[] = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0;
}

export function tmuxArgs(args: string[]) {
  const socketPath = process.env.AUTOWORKER_TMUX_SOCKET;
  if (!socketPath) return args;
  return ['-S', socketPath, ...args];
}

export function tmuxCommandOk(args: string[]) {
  const result = spawnSync('tmux', tmuxArgs(args), { encoding: 'utf8' });
  return result.status === 0;
}

function runTmux(args: string[]) {
  const result = spawnSync('tmux', tmuxArgs(args), { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `tmux ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function runCommand(command: string, args: string[], options: Parameters<typeof spawnSync>[2] = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || '').trim() || String(result.stdout || '').trim() || `${command} ${args.join(' ')} failed`);
  }
  return result;
}

function readRealpath(targetPath: string) {
  try {
    return fssync.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function executableExists(filePath: string) {
  try {
    return fssync.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function commandOutput(command: string, args: string[] = []) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function codexVersion(codexPath: string) {
  const output = commandOutput(codexPath, ['--version']);
  const match = output?.match(/\d+\.\d+\.\d+/);
  return match?.[0] || output;
}

function compareSemver(a?: string, b?: string) {
  const parse = (value?: string) => (value?.match(/\d+\.\d+\.\d+/)?.[0] || '0.0.0').split('.').map((part) => Number(part));
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function codexCandidates() {
  const candidates: CodexCandidate[] = [];
  const add = (candidatePath: string | undefined, source: string) => {
    if (!candidatePath) return;
    const resolved = path.resolve(candidatePath.replace(/^~/, os.homedir()));
    if (!executableExists(resolved) || candidates.some((candidate) => candidate.path === resolved)) return;
    candidates.push({ path: resolved, version: codexVersion(resolved), source });
  };

  add(process.env.AUTOWORKER_CODEX_BIN, 'AUTOWORKER_CODEX_BIN');
  add(commandOutput('zsh', ['-lc', 'command -v codex']), 'current-shell');
  add(path.join(os.homedir(), '.nvm', 'versions', 'node', 'v24.13.0', 'bin', 'codex'), 'preferred-nvm');
  add('/usr/local/bin/codex', 'system');
  add(commandOutput('command', ['-v', 'codex']), 'command-v');

  return candidates;
}

export function resolveCodexCommand() {
  const candidates = codexCandidates();
  if (!candidates.length) {
    return {
      path: 'codex',
      version: undefined,
      source: 'fallback',
      candidates
    };
  }
  const explicit = candidates.find((candidate) => candidate.source === 'AUTOWORKER_CODEX_BIN');
  const selected = explicit || candidates.reduce((best, candidate) => {
    if (compareSemver(candidate.version, best.version) > 0) return candidate;
    return best;
  }, candidates[0]);
  return { ...selected, candidates };
}

function codexLaunchCommand(codexPath: string, threadName: string) {
  const quotedCodex = shellQuote(codexPath);
  const quotedThread = shellQuote(threadName);
  return `${quotedCodex} resume ${quotedThread} --no-alt-screen || ${quotedCodex} --no-alt-screen`;
}

function sessionExists(sessionName: string) {
  return tmuxCommandOk(['has-session', '-t', sessionName]);
}

function sessionEnvironment(sessionName: string, key: string) {
  const result = spawnSync('tmux', tmuxArgs(['show-environment', '-t', sessionName, key]), { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const line = result.stdout.trim();
  if (!line || line === `-${key}`) return undefined;
  if (line.startsWith(`${key}=`)) return line.slice(key.length + 1);
  return undefined;
}

function sessionPanePath(sessionName: string) {
  const output = runTmux(['display-message', '-p', '-t', `${sessionName}:0.0`, '#{pane_current_path}']);
  return readRealpath(output);
}

function panePath(paneId: string) {
  const output = runTmux(['display-message', '-p', '-t', paneId, '#{pane_current_path}']);
  return readRealpath(output);
}

function paneCommand(paneId: string) {
  return runTmux(['display-message', '-p', '-t', paneId, '#{pane_current_command}']);
}

function paneTitle(paneId: string) {
  return runTmux(['display-message', '-p', '-t', paneId, '#{pane_title}']);
}

function setSessionEnvironment(sessionName: string, key: string, value: string) {
  runTmux(['set-environment', '-t', sessionName, key, value]);
}

function setPaneTitle(paneId: string, title: string) {
  runTmux(['select-pane', '-t', paneId, '-T', title]);
}

function configureSession(sessionName: string) {
  runTmux(['set-option', '-t', sessionName, 'mouse', 'on']);
}

function selectPane(paneId: string) {
  runTmux(['select-pane', '-t', paneId]);
}

function listPaneIds(sessionName: string) {
  const output = runTmux(['list-panes', '-t', sessionName, '-F', '#{pane_id}']);
  return output ? output.split('\n').filter(Boolean) : [];
}

function listPanes(sessionName: string) {
  const output = runTmux(['list-panes', '-t', sessionName, '-F', '#{pane_id}\t#{pane_title}\t#{pane_active}\t#{pane_current_path}\t#{pane_left}\t#{pane_top}']);
  return output
    ? output.split('\n').filter(Boolean).map((line) => {
        const [paneId, title, active, currentPath, paneLeft, paneTop] = line.split('\t');
        return {
          paneId,
          title,
          active,
          currentPath,
          paneLeft: Number(paneLeft || 0),
          paneTop: Number(paneTop || 0)
        };
      })
    : [];
}

function splitWindow(sessionName: string, cwd: string) {
  return runTmux(['split-window', '-t', `${sessionName}:0.0`, '-h', '-c', cwd, '-P', '-F', '#{pane_id}']);
}

function paneRoleFromTitle(paneId: string) {
  const title = paneTitle(paneId);
  if (title === 'autoworker:planner') return 'planner';
  if (title === 'autoworker:worker') return 'worker';
  return undefined;
}

function repairSessionLayout(sessionName: string, cwd: string) {
  const panes = listPanes(sessionName);
  const repoPanes = panes
    .filter((pane) => readRealpath(pane.currentPath) === cwd)
    .sort((left, right) => {
      if (left.paneTop !== right.paneTop) return left.paneTop - right.paneTop;
      return left.paneLeft - right.paneLeft;
    });

  if (repoPanes.length < 2) {
    throw new Error(`tmux session ${sessionName} missing planner/worker pane layout`);
  }

  const horizontalPanes = repoPanes.filter((pane) => pane.paneTop === repoPanes[0].paneTop);
  const orderedPanes = horizontalPanes.length >= 2 ? horizontalPanes : repoPanes;
  const plannerPane = orderedPanes[0].paneId;
  const workerPane = orderedPanes.find((pane) => pane.paneId !== plannerPane)?.paneId;

  if (!workerPane) {
    throw new Error(`tmux session ${sessionName} missing worker pane layout`);
  }

  // Layout is authoritative: planner is always the leftmost repo pane, worker is the next pane to the right.
  setPaneTitle(plannerPane, 'autoworker:planner');
  setPaneTitle(workerPane, 'autoworker:worker');
  setSessionEnvironment(sessionName, 'AUTOWORKER_REPO_ROOT', cwd);
  setSessionEnvironment(sessionName, 'AUTOWORKER_PLANNER_PANE', plannerPane);
  setSessionEnvironment(sessionName, 'AUTOWORKER_WORKER_PANE', workerPane);
  return { plannerPane, workerPane };
}

function bootstrapCodexPane(paneId: string, role: 'planner' | 'worker', cwd: string, threadName: string) {
  const currentCommand = paneCommand(paneId);
  if (currentCommand === 'codex') {
    return;
  }
  const codex = resolveCodexCommand();
  const bootstrap = [
    'env',
    `AUTOWORKER_ROLE=${shellQuote(role)}`,
    `AUTOWORKER_REPO_ROOT=${shellQuote(cwd)}`,
    `AUTOWORKER_THREAD_NAME=${shellQuote(threadName)}`,
    'sh -lc',
    shellQuote(codexLaunchCommand(codex.path, threadName))
  ].join(' ');
  runTmux(['send-keys', '-t', paneId, 'C-u']);
  runTmux(['send-keys', '-t', paneId, '-l', bootstrap]);
  runTmux(['send-keys', '-t', paneId, 'C-m']);
}

export function repoSessionName(cwd: string) {
  return path.basename(cwd);
}

export function ensureRepoTmuxSession(cwd: string) {
  const realCwd = readRealpath(cwd);
  const sessionName = repoSessionName(realCwd);
  const plannerThread = `${sessionName}-planner`;
  const workerThread = `${sessionName}-worker`;
  let status: 'created' | 'reused' = 'created';

  if (sessionExists(sessionName)) {
    const existingRoot = sessionEnvironment(sessionName, 'AUTOWORKER_REPO_ROOT');
    const existingPath = sessionPanePath(sessionName);
    if (existingRoot && readRealpath(existingRoot) !== realCwd) {
      throw new Error(`tmux session ${sessionName} belongs to another directory: ${existingRoot}`);
    }
    if (!existingRoot && existingPath !== realCwd) {
      throw new Error(`tmux session ${sessionName} belongs to another directory: ${existingPath}`);
    }
    status = 'reused';
  } else {
    runTmux(['new-session', '-d', '-s', sessionName, '-c', realCwd]);
  }
  configureSession(sessionName);

  const panes = listPaneIds(sessionName);
  let plannerPane = sessionEnvironment(sessionName, 'AUTOWORKER_PLANNER_PANE') || panes.find((paneId) => paneRoleFromTitle(paneId) === 'planner');
  let workerPane = sessionEnvironment(sessionName, 'AUTOWORKER_WORKER_PANE') || panes.find((paneId) => paneRoleFromTitle(paneId) === 'worker');

  if (!plannerPane) plannerPane = panes[0];
  if (!workerPane || workerPane === plannerPane) workerPane = splitWindow(sessionName, realCwd);
  ({ plannerPane, workerPane } = repairSessionLayout(sessionName, realCwd));

  const codex = resolveCodexCommand();
  setSessionEnvironment(sessionName, 'AUTOWORKER_CODEX_BIN', codex.path);
  if (codex.version) setSessionEnvironment(sessionName, 'AUTOWORKER_CODEX_VERSION', codex.version);
  bootstrapCodexPane(plannerPane, 'planner', realCwd, plannerThread);
  bootstrapCodexPane(workerPane, 'worker', realCwd, workerThread);
  selectPane(plannerPane);

  return {
    name: sessionName,
    status,
    plannerPane,
    workerPane,
    plannerThread,
    workerThread,
    codexPath: codex.path,
    codexVersion: codex.version,
    codexCandidates: codex.candidates
  };
}

export async function armAutoworkerRuntime(cwd: string, plannerPane: string) {
  const sessionName = repoSessionName(cwd);
  repairSessionLayout(sessionName, readRealpath(cwd));
  const runtimeEnv = {
    ...process.env,
    AUTOWORKER_TMUX_SOCKET: process.env.AUTOWORKER_TMUX_SOCKET || '',
    TMUX: `${process.env.AUTOWORKER_TMUX_SOCKET || ''},0,0`,
    TMUX_PANE: plannerPane
  };
  runCommand('python3', [assetPath('skill-autoworker', 'scripts', 'autoworker.py'), 'start', '--cwd', cwd], {
    env: runtimeEnv
  });
  const statePath = path.join(cwd, '.autoworker', 'state', 'autoworker-state.json');
  const state = await readJsonIfExists<Record<string, unknown>>(statePath);
  if (!state) {
    throw new Error(`autoworker runtime state missing after launch: ${statePath}`);
  }
  return { statePath, state };
}

export function enterTmuxSession(sessionName: string, plannerPane: string) {
  const mode = process.env.TMUX ? 'switch' : 'attach';
  if (process.env.AUTOWORKER_DISABLE_ATTACH === '1') {
    console.log(`enter session=${sessionName} planner_pane=${plannerPane} mode=${mode}`);
    return;
  }
  selectPane(plannerPane);
  const args = mode === 'switch'
    ? ['switch-client', '-t', sessionName]
    : ['attach-session', '-t', sessionName];
  const result = spawnSync('tmux', tmuxArgs(args), { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`tmux ${args.join(' ')} failed`);
  }
}

export function requireOmx(skip = false) {
  if (skip || process.env.AUTOWORKER_SKIP_OMX_CHECK === '1') return;
  if (!commandOk('omx')) {
    throw new Error('omx 未安装或不在 PATH 中。请先安装 oh-my-codex。');
  }
}

export async function patchHooks(codexHome: string) {
  const hooksPath = path.join(codexHome, 'hooks.json');
  const hooks = (await readJsonIfExists<HooksFile>(hooksPath)) || { hooks: {} };
  hooks.hooks ||= {};

  const autoworkerScript = `python3 \"${path.join(codexHome, 'skills', 'autoworker', 'scripts', 'autoworker.py')}\"`;
  const stopWrapper = `python3 \"${path.join(codexHome, 'skills', 'autoworker', 'scripts', 'omx-stop-wrapper.py')}\"`;

  hooks.hooks.SessionStart ||= [];
  hooks.hooks.UserPromptSubmit ||= [];
  hooks.hooks.Stop ||= [];

  const removeLegacyCommands = (entries: HookEntry[] = []) => {
    return entries.filter((entry) => {
      const raw = JSON.stringify(entry);
      return !raw.includes('/skills/autocode/scripts/autocode.py');
    });
  };

  hooks.hooks.SessionStart = removeLegacyCommands(hooks.hooks.SessionStart);
  hooks.hooks.UserPromptSubmit = removeLegacyCommands(hooks.hooks.UserPromptSubmit);
  hooks.hooks.Stop = removeLegacyCommands(hooks.hooks.Stop);

  const ensureCommand = (entries: HookEntry[], command: string, statusMessage?: string, timeout?: number) => {
    const existing = entries.find((entry) => Array.isArray(entry.hooks) && entry.hooks.some((hook) => hook.command === command));
    if (existing) return;
    const hook: HookCommand = { type: 'command', command };
    if (statusMessage) hook.statusMessage = statusMessage;
    if (timeout) hook.timeout = timeout;
    entries.push({ hooks: [hook] });
  };

  ensureCommand(hooks.hooks.SessionStart, `${autoworkerScript} hook`, 'Refreshing autoworker watchdog');
  ensureCommand(hooks.hooks.UserPromptSubmit, `${autoworkerScript} hook`, 'Refreshing autoworker watchdog');

  let replacedStop = false;
  for (const entry of hooks.hooks.Stop) {
    if (!Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (hook.type === 'command' && (String(hook.command || '').includes('codex-native-hook.js') || String(hook.command || '').includes('omx-stop-wrapper.py'))) {
        hook.command = stopWrapper;
        hook.timeout = 30;
        delete hook.statusMessage;
        replacedStop = true;
      }
    }
  }
  if (!replacedStop) {
    hooks.hooks.Stop.unshift({ hooks: [{ type: 'command', command: stopWrapper, timeout: 30 }] });
  }
  ensureCommand(hooks.hooks.Stop, `${autoworkerScript} stop-hook`, 'Autoworker stop-hook dispatch');

  await writeJson(hooksPath, hooks);
  return hooksPath;
}

export async function installSkills(codexHome: string) {
  const skillsRoot = path.join(codexHome, 'skills');
  await ensureDir(skillsRoot);
  await copyDir(assetPath('skill-autoworker'), path.join(skillsRoot, 'autoworker'));
  await fs.rm(path.join(skillsRoot, 'autocode'), { recursive: true, force: true });
}

export function printPaths(codexHome: string) {
  console.log(JSON.stringify({
    codexHome,
    autoworkerSkill: path.join(codexHome, 'skills', 'autoworker'),
    hooks: path.join(codexHome, 'hooks.json')
  }, null, 2));
}

export function fileExists(filePath: string) {
  return fssync.existsSync(filePath);
}
