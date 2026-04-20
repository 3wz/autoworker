import path from 'node:path';
import { codexHomeFromArgs, commandOk, fileExists, printPaths } from '../install/common.js';

export async function doctorCommand(args: string[] = []) {
  const codexHome = codexHomeFromArgs(args);
  const autoworkerSkill = path.join(codexHome, 'skills', 'autoworker', 'SKILL.md');
  const hooks = path.join(codexHome, 'hooks.json');
  console.log(JSON.stringify({
    omxAvailable: commandOk('omx'),
    codexHome,
    autoworkerInstalled: fileExists(autoworkerSkill),
    hooksExists: fileExists(hooks)
  }, null, 2));
  printPaths(codexHome);
}
