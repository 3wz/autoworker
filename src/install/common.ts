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
