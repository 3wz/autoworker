import { ensureRepoTmuxSession, enterTmuxSession } from '../install/common.js';

export async function launchCommand() {
  const cwd = process.cwd();
  const session = ensureRepoTmuxSession(cwd);
  console.log(`${session.name} ${session.status}`);
  console.log(`planner_thread=${session.plannerThread}`);
  console.log(`worker_thread=${session.workerThread}`);
  console.log(`planner_pane=${session.plannerPane}`);
  console.log(`worker_pane=${session.workerPane}`);
  console.log(`codex_bin=${session.codexPath}`);
  if (session.codexVersion) console.log(`codex_version=${session.codexVersion}`);
  const versions = new Set(session.codexCandidates.map((candidate) => candidate.version).filter(Boolean));
  if (session.codexCandidates.length > 1 && versions.size > 1) {
    console.log(`codex_candidates=${session.codexCandidates.map((candidate) => `${candidate.path}@${candidate.version || 'unknown'}`).join(',')}`);
  }
  enterTmuxSession(session.name, session.plannerPane);
}
