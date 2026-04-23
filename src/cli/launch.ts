import { ensureRepoTmuxSession, enterTmuxSession, armAutoworkerRuntime } from '../install/common.js';

export async function launchCommand() {
  const cwd = process.cwd();
  const session = ensureRepoTmuxSession(cwd);
  const runtime = await armAutoworkerRuntime(cwd, session.plannerPane);
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
  console.log('supervision=armed');
  console.log(`state_path=${runtime.statePath}`);
  if (runtime.state.watcher_pid) console.log(`watcher_pid=${runtime.state.watcher_pid}`);
  enterTmuxSession(session.name, session.plannerPane);
}
