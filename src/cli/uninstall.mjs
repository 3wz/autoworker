import fs from 'node:fs/promises';
import path from 'node:path';
import { codexHomeFromArgs, readJsonIfExists, writeJson } from '../install/common.mjs';

export async function uninstallCommand(args = []) {
  const codexHome = codexHomeFromArgs(args);
  await fs.rm(path.join(codexHome, 'skills', 'autoworker'), { recursive: true, force: true });
  await fs.rm(path.join(codexHome, 'skills', 'autocode'), { recursive: true, force: true });
  const hooksPath = path.join(codexHome, 'hooks.json');
  const hooks = await readJsonIfExists(hooksPath);
  if (hooks?.hooks) {
    for (const key of Object.keys(hooks.hooks)) {
      hooks.hooks[key] = (hooks.hooks[key] || []).filter((entry) => !JSON.stringify(entry).includes('autoworker') && !JSON.stringify(entry).includes('autocode.py'));
    }
    await writeJson(hooksPath, hooks);
  }
  console.log('autoworker uninstall complete');
}
