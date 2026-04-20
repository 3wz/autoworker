import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

export function codexHomeFromArgs(args = []) {
  const idx = args.indexOf('--codex-home');
  if (idx >= 0 && args[idx + 1]) return path.resolve(args[idx + 1]);
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function assetPath(...parts) {
  return path.join(ROOT, 'assets', ...parts);
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function copyDir(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true });
}

export async function readJsonIfExists(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeJson(p, value) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function commandOk(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0;
}

export function requireOmx(skip = false) {
  if (skip || process.env.AUTOWORKER_SKIP_OMX_CHECK === '1') return;
  if (!commandOk('omx')) {
    throw new Error('omx 未安装或不在 PATH 中。请先安装 oh-my-codex。');
  }
}

export async function patchHooks(codexHome) {
  const hooksPath = path.join(codexHome, 'hooks.json');
  const hooks = await readJsonIfExists(hooksPath) || { hooks: {} };
  hooks.hooks ||= {};

  const autoworkerScript = `python3 \"${path.join(codexHome, 'skills', 'autoworker', 'scripts', 'autoworker.py')}\"`;
  const stopWrapper = `python3 \"${path.join(codexHome, 'skills', 'autoworker', 'scripts', 'omx-stop-wrapper.py')}\"`;

  hooks.hooks.SessionStart ||= [];
  hooks.hooks.UserPromptSubmit ||= [];
  hooks.hooks.Stop ||= [];

  const removeLegacyCommands = (entries) => {
    return (entries || []).filter((entry) => {
      const raw = JSON.stringify(entry);
      return !raw.includes('/skills/autocode/scripts/autocode.py\" hook')
        && !raw.includes('/skills/autocode/scripts/autocode.py\" stop-hook');
    });
  };

  hooks.hooks.SessionStart = removeLegacyCommands(hooks.hooks.SessionStart);
  hooks.hooks.UserPromptSubmit = removeLegacyCommands(hooks.hooks.UserPromptSubmit);
  hooks.hooks.Stop = removeLegacyCommands(hooks.hooks.Stop);

  const ensureCommand = (entries, command, statusMessage = undefined, timeout = undefined) => {
    const existing = entries.find((entry) => Array.isArray(entry.hooks) && entry.hooks.some((hook) => hook.command === command));
    if (existing) return;
    const hook = { type: 'command', command };
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

export async function installSkills(codexHome) {
  const skillsRoot = path.join(codexHome, 'skills');
  await ensureDir(skillsRoot);
  await copyDir(assetPath('skill-autoworker'), path.join(skillsRoot, 'autoworker'));
  await copyDir(assetPath('skill-autocode'), path.join(skillsRoot, 'autocode'));
}

export function printPaths(codexHome) {
  console.log(JSON.stringify({
    codexHome,
    autoworkerSkill: path.join(codexHome, 'skills', 'autoworker'),
    autocodeAlias: path.join(codexHome, 'skills', 'autocode'),
    hooks: path.join(codexHome, 'hooks.json')
  }, null, 2));
}

export function fileExists(p) {
  return fssync.existsSync(p);
}
