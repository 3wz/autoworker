#!/usr/bin/env node
import { setupCommand } from '../dist/cli/setup.js';
import { doctorCommand } from '../dist/cli/doctor.js';
import { statusCommand } from '../dist/cli/status.js';
import { uninstallCommand } from '../dist/cli/uninstall.js';
import { launchCommand } from '../dist/cli/launch.js';

const [, , cmd = 'help', ...args] = process.argv;
const HELP_TEXT = `autoworker - OMX + Codex tmux launcher

Usage:
  autoworker          Create or reuse one repo tmux session with planner/worker panes and enter planner
  autoworker launch   Explicit launch entrypoint
  autoworker setup    Install autoworker skills and patch hooks
  autoworker doctor   Check local installation health
  autoworker status   Show installed skill status
  autoworker uninstall Remove installed skills and hook entries
  autoworker help     Show this help message

Session Behavior:
  <dirname>           Repo session for the current repository
  planner pane        Planner pane in the main window
  worker pane         Worker pane in the main window

Launch Rules:
  No arguments        Same as: autoworker launch
  Inside tmux         Switch the current client to the planner session
  Outside tmux        Attach directly to the planner session
  Existing sessions   Reused without being killed

Examples:
  autoworker
  autoworker launch
  autoworker setup
  autoworker doctor`;

function printHelp() {
  console.log(HELP_TEXT);
}

async function main() {
  if (process.argv.length <= 2) {
    await launchCommand();
    return;
  }

  switch (cmd) {
    case 'launch':
      await launchCommand();
      return;
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
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exitCode = 1;
      return;
  }
}

main().catch((error) => {
  console.error(`[autoworker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
