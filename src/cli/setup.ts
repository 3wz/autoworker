import { codexHomeFromArgs, installSkills, patchHooks, printPaths, requireOmx } from '../install/common.js';

export async function setupCommand(args: string[] = []) {
  const codexHome = codexHomeFromArgs(args);
  const skip = args.includes('--skip-omx-check');
  requireOmx(skip);
  await installSkills(codexHome);
  const hooksPath = await patchHooks(codexHome);
  console.log('autoworker setup complete');
  console.log(`hooks updated: ${hooksPath}`);
  printPaths(codexHome);
}
