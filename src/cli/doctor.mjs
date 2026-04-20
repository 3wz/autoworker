import path from 'node:path';
import { codexHomeFromArgs, commandOk, fileExists, printPaths } from '../install/common.mjs';

export async function doctorCommand(args = []) {
  const codexHome = codexHomeFromArgs(args);
  const autoworkerSkill = path.join(codexHome, 'skills', 'autoworker', 'SKILL.md');
  const autocodeAlias = path.join(codexHome, 'skills', 'autocode', 'SKILL.md');
  const hooks = path.join(codexHome, 'hooks.json');
  console.log(JSON.stringify({
    omxAvailable: commandOk('omx'),
    codexHome,
    autoworkerInstalled: fileExists(autoworkerSkill),
    autocodeAliasInstalled: fileExists(autocodeAlias),
    hooksExists: fileExists(hooks)
  }, null, 2));
  printPaths(codexHome);
}
