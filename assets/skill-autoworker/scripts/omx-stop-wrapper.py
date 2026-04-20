#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path

CODEX_NATIVE_HOOK = "/Users/wz/.nvm/versions/node/v24.13.0/lib/node_modules/oh-my-codex/dist/scripts/codex-native-hook.js"
STATE_FILENAMES = ("autoworker-state.json",)


def safe_read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def current_tmux_pane():
    return os.environ.get('TMUX_PANE', '').strip()


def resolve_tmux_socket():
    raw = os.environ.get('TMUX', '').strip()
    if not raw:
        return None
    if ',' in raw:
        return raw.split(',', 1)[0]
    return raw


def run_tmux(args: list[str]) -> str | None:
    cmd = ['tmux']
    socket_path = resolve_tmux_socket()
    if socket_path:
        cmd.extend(['-S', socket_path])
    proc = subprocess.run(cmd + args, text=True, capture_output=True, env=os.environ.copy())
    if proc.returncode != 0:
        return None
    return proc.stdout.strip() or None


def current_pane_path():
    pane = current_tmux_pane()
    if not pane:
        return None
    return run_tmux(['display-message', '-p', '-t', pane, '#{pane_current_path}'])


def iter_state_candidates(start: str | None):
    if not start:
        return
    try:
        path = Path(start).expanduser().resolve()
    except Exception:
        return
    if path.is_file():
        path = path.parent
    for base in (path, *path.parents):
        state_dir = base / '.omx' / 'state'
        for name in STATE_FILENAMES:
            candidate = state_dir / name
            if candidate.exists():
                yield candidate


def path_is_within(path_str: str | None, root_str: str | None) -> bool:
    if not path_str or not root_str:
        return False
    try:
        path = Path(path_str).expanduser().resolve()
        root = Path(root_str).expanduser().resolve()
    except Exception:
        return False
    return path == root or root in path.parents


def iter_matching_states(payload: dict):
    payload_cwd = (payload.get('cwd') or '').strip() or None
    pane_path = current_pane_path()
    seen = set()
    for start in (payload_cwd, os.getcwd(), pane_path):
        for candidate in iter_state_candidates(start):
            key = str(candidate)
            if key in seen:
                continue
            seen.add(key)
            state = safe_read_json(candidate)
            if not isinstance(state, dict) or not state.get('enabled'):
                continue
            repo = (state.get('repo') or '').strip()
            if repo and not any(
                path_is_within(context_path, repo)
                for context_path in (payload_cwd, os.getcwd(), pane_path)
                if context_path
            ):
                continue
            yield state


def should_bypass_stop(payload: dict) -> bool:
    current_pane = current_tmux_pane()
    if not current_pane:
        return False
    for state in iter_matching_states(payload):
        supervisor_pane = (state.get('supervisor_pane') or '').strip()
        worker_pane = (state.get('target_pane') or '').strip()
        if current_pane == supervisor_pane and current_pane != worker_pane:
            # 只对 supervisor 会话放行；worker 仍交给 OMX 原生 stop hook 决定
            return True
    return False


def main():
    raw = sys.stdin.read()
    payload = {}
    if raw.strip():
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}

    if should_bypass_stop(payload):
        sys.stdout.write(json.dumps({"decision": "allow"}))
        return 0

    proc = subprocess.run(
        ["node", CODEX_NATIVE_HOOK],
        input=raw,
        text=True,
        capture_output=True,
        env=os.environ.copy(),
    )
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == '__main__':
    raise SystemExit(main())
