import { ensureTmuxSession } from '../install/common.js';

export async function launchCommand() {
  const cwd = process.cwd();
  const sessions = ['planner', 'worker'] as const;

  for (const sessionName of sessions) {
    const status = ensureTmuxSession(sessionName, cwd);
    console.log(`${sessionName} ${status}`);
  }
}
