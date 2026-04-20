import fs from 'node:fs/promises';
import path from 'node:path';
import { codexHomeFromArgs, readJsonIfExists, writeJson } from '../install/common.js';

type HookCommand = {
  type?: string;
  command?: string;
  statusMessage?: string;
  timeout?: number;
};

type HookEntry = {
  hooks?: HookCommand[];
};

type HooksFile = {
  hooks?: Record<string, HookEntry[]>;
};

export async function uninstallCommand(args: string[] = []) {
  const codexHome = codexHomeFromArgs(args);
  await fs.rm(path.join(codexHome, 'skills', 'autoworker'), { recursive: true, force: true });
  await fs.rm(path.join(codexHome, 'skills', 'autocode'), { recursive: true, force: true });
  const hooksPath = path.join(codexHome, 'hooks.json');
  const hooks = await readJsonIfExists<HooksFile>(hooksPath);
  if (hooks?.hooks) {
    for (const key of Object.keys(hooks.hooks)) {
      hooks.hooks[key] = (hooks.hooks[key] || []).filter((entry) => {
        const raw = JSON.stringify(entry);
        return !raw.includes('autoworker') && !raw.includes('autocode.py');
      });
    }
    await writeJson(hooksPath, hooks);
  }
  console.log('autoworker uninstall complete');
}
