#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path

CODEX_NATIVE_HOOK = "/Users/wz/.nvm/versions/node/v24.13.0/lib/node_modules/oh-my-codex/dist/scripts/codex-native-hook.js"


def safe_read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def find_autoworker_state(cwd: str | None):
    candidates = []
    if cwd:
        base = Path(cwd) / '.omx' / 'state'
        candidates.extend([base / 'autoworker-state.json', base / 'autocode-state.json'])
    base = Path.cwd() / '.omx' / 'state'
    candidates.extend([base / 'autoworker-state.json', base / 'autocode-state.json'])
    seen = set()
    for candidate in candidates:
        if str(candidate) in seen:
            continue
        seen.add(str(candidate))
        if candidate.exists():
            return candidate
    return None


def current_tmux_pane():
    return os.environ.get('TMUX_PANE', '').strip()


def should_bypass_stop(payload: dict) -> bool:
    cwd = (payload.get('cwd') or '').strip()
    state_path = find_autoworker_state(cwd)
    if not state_path:
        return False
    state = safe_read_json(state_path)
    if not isinstance(state, dict):
        return False
    if not state.get('enabled'):
        return False
    supervisor_pane = (state.get('supervisor_pane') or '').strip()
    worker_pane = (state.get('target_pane') or '').strip()
    current_pane = current_tmux_pane()
    if not current_pane:
        return False
    # 只对 supervisor 会话放行；worker 仍交给 OMX 原生 stop hook 决定
    return current_pane == supervisor_pane and current_pane != worker_pane


def main():
    raw = sys.stdin.read()
    payload = {}
    if raw.strip():
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}

    if should_bypass_stop(payload):
        sys.stdout.write(json.dumps({"decision": "approve"}))
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
