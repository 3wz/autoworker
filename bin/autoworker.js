#!/usr/bin/env node
import { setupCommand } from '../dist/cli/setup.js';
import { doctorCommand } from '../dist/cli/doctor.js';
import { statusCommand } from '../dist/cli/status.js';
import { uninstallCommand } from '../dist/cli/uninstall.js';

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
