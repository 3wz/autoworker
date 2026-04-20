import path from 'node:path';
import fs from 'node:fs/promises';
import { codexHomeFromArgs } from '../install/common.mjs';

export async function statusCommand(args = []) {
  const codexHome = codexHomeFromArgs(args);
  const skills = [
    path.join(codexHome, 'skills', 'autoworker', 'SKILL.md'),
    path.join(codexHome, 'skills', 'autocode', 'SKILL.md')
  ];
  const result = {};
  for (const p of skills) {
    try {
      await fs.access(p);
      result[p] = 'present';
    } catch {
      result[p] = 'missing';
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
