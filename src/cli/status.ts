import path from 'node:path';
import fs from 'node:fs/promises';
import { codexHomeFromArgs } from '../install/common.js';

export async function statusCommand(args: string[] = []) {
  const codexHome = codexHomeFromArgs(args);
  const skills = [path.join(codexHome, 'skills', 'autoworker', 'SKILL.md')];
  const result: Record<string, 'present' | 'missing'> = {};
  for (const skillPath of skills) {
    try {
      await fs.access(skillPath);
      result[skillPath] = 'present';
    } catch {
      result[skillPath] = 'missing';
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
