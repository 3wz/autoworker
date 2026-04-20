#!/usr/bin/env node
import { setupCommand } from '../src/cli/setup.mjs';
import { doctorCommand } from '../src/cli/doctor.mjs';
import { statusCommand } from '../src/cli/status.mjs';
import { uninstallCommand } from '../src/cli/uninstall.mjs';

const [, , cmd = 'help', ...args] = process.argv;

async function main() {
  switch (cmd) {
    case 'setup':
      await setupCommand(args);
      return;
    case 'doctor':
      await doctorCommand(args);
      return;
    case 'status':
      await statusCommand(args);
      return;
    case 'uninstall':
      await uninstallCommand(args);
      return;
    case 'help':
    case '--help':
    case '-h':
    default:
      console.log(`autoworker

Commands:
  autoworker setup
  autoworker doctor
  autoworker status
  autoworker uninstall`);
  }
}

main().catch((error) => {
  console.error(`[autoworker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
