#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SHELL_COMMANDS = {"bash", "zsh", "sh", "fish"}
DEFAULT_TARGET_HINTS = ["gamepilot-code", "-code", " code "]
DEFAULT_DISPATCH_TEMPLATE = (
    "继续执行当前主线，不要停在分析/文档/contract 收口。\n"
    "当前唯一优先级：真实 runtime / mod / host 推进。\n"
    "不要做微提交；先累计阶段成果，再统一验证并中文提交。\n"
    "如果没有 blocker，不要停下来等我。"
)
DEFAULT_AUTO_FALLBACK_AFTER_MS = 45000
DEFAULT_NODE_IDLE_STOP_MS = 30000
DEFAULT_EVENT_TEMPLATE = (
    "$autoworker AUTOWORKER_EVENT\n"
    "worker_session={worker_session}\n"
    "worker_pane={worker_pane}\n"
    "worker_state=stopped\n"
    "reason={reason}\n"
    "cwd={cwd}\n"
    "tail:\n{tail}\n\n"
    "请直接接管并继续驱动 code 会话开发：先判断下一步，再下达命令给 worker，不要只做解释。"
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def safe_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def resolve_tmux_socket() -> str | None:
    raw = os.environ.get("TMUX", "")
    if raw and "," in raw:
        return raw.split(",", 1)[0]
    if raw:
        return raw
    return None


def run_tmux(args: list[str], socket_path: str | None = None, check: bool = True) -> str:
    cmd = ["tmux"]
    if socket_path:
        cmd.extend(["-S", socket_path])
    proc = subprocess.run([*cmd, *args], capture_output=True, text=True, env=os.environ.copy())
    if check and proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"tmux failed: {' '.join(args)}")
    return proc.stdout


def current_pane(socket_path: str | None = None) -> str | None:
    pane = os.environ.get("TMUX_PANE")
    if pane:
        return pane
    try:
        return run_tmux(["display-message", "-p", "#{pane_id}"], socket_path=socket_path).strip() or None
    except Exception:
        return None


def current_session(socket_path: str | None = None) -> str | None:
    try:
        return run_tmux(["display-message", "-p", "#{session_name}"], socket_path=socket_path).strip() or None
    except Exception:
        return None


def list_panes(socket_path: str | None = None) -> list[dict[str, str]]:
    fmt = "#{session_name}\t#{window_index}.#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_active}\t#{pane_current_path}\t#{pane_title}"
    out = run_tmux(["list-panes", "-a", "-F", fmt], socket_path=socket_path)
    panes: list[dict[str, str]] = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 7:
            continue
        panes.append(
            {
                "session_name": parts[0],
                "pane_ref": parts[1],
                "pane_id": parts[2],
                "pane_current_command": parts[3],
                "pane_active": parts[4],
                "pane_current_path": parts[5],
                "pane_title": parts[6],
            }
        )
    return panes


def capture_tail(pane_id: str, socket_path: str | None = None, lines: int = 40) -> str:
    try:
        return run_tmux(["capture-pane", "-p", "-t", pane_id, "-S", f"-{lines}"], socket_path=socket_path)
    except Exception:
        return ""


def tail_excerpt(text: str, last_lines: int = 6) -> str:
    noise_tokens = [
        '[AUTOCODE_NUDGE]',
        'tab to queue message',
        'Conversation interrupted',
        'tell the model what to do differently',
        'Messages to be submitted after next tool call',
        'press esc to interrupt and send immediately',
        'gpt-5.',
        'Explain this codebase',
        'Updating Plan',
        'Updated Plan',
        'Working (',
        'Exploring',
        'Considering',
    ]
    cleaned: list[str] = []
    for raw in text.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            continue
        if any(token.lower() in line.lower() for token in noise_tokens):
            continue
        if stripped.startswith('› '):
            continue
        if stripped.startswith('• Waiting for background terminal'):
            continue
        if stripped.startswith('• Working'):
            continue
        if stripped.startswith('• Updated Plan'):
            continue
        if stripped.startswith('• I’m ') or stripped.startswith("• I'm "):
            continue
        if stripped.startswith('• Thinking') or stripped.startswith('• Considering'):
            continue
        if stripped.startswith('• Explored'):
            continue
        if stripped.startswith('│'):
            continue
        cleaned.append(line[:180])
    return "\n".join(cleaned[-last_lines:])


def pane_has_queued_codex_submission(captured: str) -> bool:
    normalized = (captured or '').lower()
    return (
        'messages to be submitted after next tool call' in normalized
        or 'press esc to interrupt and send immediately' in normalized
        or 'tab to queue message' in normalized
    )


def pane_requires_escape_submit(captured: str) -> bool:
    normalized = (captured or '').lower()
    return (
        'messages to be submitted after next tool call' in normalized
        or 'press esc to interrupt and send immediately' in normalized
    )


def pane_requires_tab_queue(captured: str) -> bool:
    normalized = (captured or '').lower()
    return 'tab to queue message' in normalized


def signature_for(pane: dict[str, str], tail: str) -> str:
    h = hashlib.sha256()
    h.update((pane.get("pane_current_command", "") + "\n" + tail).encode("utf-8", "ignore"))
    return h.hexdigest()


def repo_state_paths(cwd: Path) -> tuple[Path, Path]:
    omx = cwd / ".omx"
    return omx / "state" / "autoworker-state.json", omx / "logs" / "autoworker-watch.log"


def process_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def find_matches_by_hint(panes: list[dict[str, str]], hint: str, socket_path: str | None) -> list[dict[str, str]]:
    hint_l = hint.lower()
    matched = []
    for pane in panes:
        haystacks = [pane["session_name"], pane["pane_id"], pane["pane_ref"], pane["pane_current_path"], pane["pane_title"]]
        tail = capture_tail(pane["pane_id"], socket_path=socket_path, lines=20)
        if any(hint_l in item.lower() for item in haystacks if item) or hint_l in tail.lower():
            matched.append(pane)
    return matched


def rank_candidates(candidates: list[dict[str, str]], socket_path: str | None) -> list[dict[str, str]]:
    def score(pane: dict[str, str]) -> tuple[int, int, int]:
        tail_l = capture_tail(pane["pane_id"], socket_path=socket_path, lines=20).lower()
        fields = f"{pane['session_name']} {pane['pane_title']} {pane['pane_ref']}".lower()
        named = any(token in fields or token in tail_l for token in DEFAULT_TARGET_HINTS)
        prompt_like = any(line.strip().startswith("› ") for line in capture_tail(pane["pane_id"], socket_path=socket_path, lines=20).splitlines()[-8:])
        return (int(named), int(pane["pane_current_command"] in {"node", *SHELL_COMMANDS}), int(prompt_like))
    return sorted(candidates, key=score, reverse=True)


def detect_candidates(cwd: Path, hint: str | None, explicit_pane: str | None, supervisor_pane: str | None, socket_path: str | None) -> tuple[str | None, list[dict[str, str]], str]:
    panes = list_panes(socket_path=socket_path)
    this_pane = supervisor_pane or current_pane(socket_path=socket_path)
    if explicit_pane:
        for pane in panes:
            if pane["pane_id"] == explicit_pane:
                return explicit_pane, [pane], "explicit-pane"
        raise RuntimeError(f"未找到 pane: {explicit_pane}")

    if hint:
        matches = [p for p in find_matches_by_hint(panes, hint, socket_path=socket_path) if p["pane_id"] != this_pane]
        ranked = rank_candidates(matches, socket_path=socket_path)
        if len(ranked) == 1:
            return ranked[0]["pane_id"], ranked, f"hint:{hint}"
        if len(ranked) > 1:
            return None, ranked, f"ambiguous-hint:{hint}"
        return None, [], f"missing-hint:{hint}"

    same_repo = [p for p in panes if Path(p["pane_current_path"]).resolve() == cwd.resolve() and p["pane_id"] != this_pane]
    ranked = rank_candidates(same_repo, socket_path=socket_path)
    if len(ranked) == 1:
        return ranked[0]["pane_id"], ranked, "same-cwd-single"
    strong = [p for p in ranked if p["pane_current_command"] in {"node", *SHELL_COMMANDS}]
    if len(strong) == 1:
        return strong[0]["pane_id"], strong, "same-cwd-strong-single"
    return None, ranked or panes, "ambiguous"


def send_prompt_to_pane(
    pane_target: str,
    message: str,
    socket_path: str | None,
    clear_input: bool = True,
    submit_key_presses: int = 2,
    submit_delay_ms: int = 150,
    allow_interrupt: bool = False,
) -> None:
    if clear_input:
        run_tmux(["send-keys", "-t", pane_target, "C-u"], socket_path=socket_path, check=False)
    run_tmux(["send-keys", "-t", pane_target, "-l", message], socket_path=socket_path)
    for _ in range(max(1, submit_key_presses)):
        time.sleep(max(0, submit_delay_ms) / 1000.0)
        run_tmux(["send-keys", "-t", pane_target, "C-m"], socket_path=socket_path)

    time.sleep(0.2)
    visible = capture_tail(pane_target, socket_path=socket_path, lines=24)
    if pane_has_queued_codex_submission(visible):
        if pane_requires_escape_submit(visible) and allow_interrupt:
            run_tmux(["send-keys", "-t", pane_target, "Escape"], socket_path=socket_path, check=False)
            time.sleep(0.15)
        elif pane_requires_tab_queue(visible):
            run_tmux(["send-keys", "-t", pane_target, "Tab"], socket_path=socket_path, check=False)
            time.sleep(0.08)
            run_tmux(["send-keys", "-t", pane_target, "C-m"], socket_path=socket_path, check=False)
            time.sleep(0.15)
        else:
            run_tmux(["send-keys", "-t", pane_target, "C-m"], socket_path=socket_path, check=False)
            time.sleep(0.15)

        visible = capture_tail(pane_target, socket_path=socket_path, lines=24)
        if pane_requires_escape_submit(visible) and allow_interrupt:
            run_tmux(["send-keys", "-t", pane_target, "Escape"], socket_path=socket_path, check=False)
            time.sleep(0.15)
        elif pane_has_queued_codex_submission(visible):
            run_tmux(["send-keys", "-t", pane_target, "C-m"], socket_path=socket_path, check=False)
            time.sleep(0.15)


def ensure_watcher(cwd: Path, state: dict[str, Any], log_path: Path) -> dict[str, Any]:
    if process_alive(state.get("watcher_pid")):
        return state
    log_path.parent.mkdir(parents=True, exist_ok=True)
    socket_path = state.get("tmux_socket_path") or resolve_tmux_socket() or ""
    with log_path.open("a") as fh:
        proc = subprocess.Popen(
            [sys.executable, __file__, "watch", "--cwd", str(cwd), "--socket", socket_path],
            stdout=fh,
            stderr=fh,
            start_new_session=True,
            env=os.environ.copy(),
        )
    state["watcher_pid"] = proc.pid
    state["watcher_started_at"] = now_iso()
    return state


def load_state(cwd: Path) -> tuple[Path, Path, dict[str, Any]]:
    state_path, log_path = repo_state_paths(cwd)
    state = safe_read_json(state_path, default=None)
    if not state:
        legacy_state_path = cwd / ".omx" / "state" / "autocode-state.json"
        state = safe_read_json(legacy_state_path, default={}) or {}
    return state_path, log_path, state or {}


def print_status(state: dict[str, Any]) -> None:
    if not state:
        print("autoworker: 当前项目未启用")
        return
    print(f"enabled: {state.get('enabled', False)}")
    print(f"target_pane: {state.get('target_pane', '—')}")
    print(f"target_session: {state.get('target_session', '—')}")
    print(f"supervisor_pane: {state.get('supervisor_pane', '—')}")
    print(f"supervisor_session: {state.get('supervisor_session', '—')}")
    print(f"watcher_pid: {state.get('watcher_pid', '—')}")
    print(f"last_event_at: {state.get('last_event_at', '—')}")
    print(f"last_worker_state: {state.get('last_worker_state', '—')}")
    print(f"pending_supervisor_action: {state.get('pending_supervisor_action', False)}")
    print(f"last_reason: {state.get('last_reason', '—')}")
    print(f"cooldown_ms: {state.get('cooldown_ms', '—')}")
    print(f"stalled_timeout_ms: {state.get('stalled_timeout_ms', '—')}")
    print(f"node_idle_stop_ms: {state.get('node_idle_stop_ms', DEFAULT_NODE_IDLE_STOP_MS)}")
    print(f"auto_fallback_after_ms: {state.get('auto_fallback_after_ms', DEFAULT_AUTO_FALLBACK_AFTER_MS)}")
    print(f"last_auto_dispatch_at: {state.get('last_auto_dispatch_at', '—')}")
    print(f"auto_dispatch_count: {state.get('auto_dispatch_count', 0)}")


def cmd_start(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    state_path, log_path, state = load_state(cwd)
    socket_path = resolve_tmux_socket()
    supervisor_pane = current_pane(socket_path=socket_path)
    supervisor_session = current_session(socket_path=socket_path)
    target_pane, candidates, reason = detect_candidates(cwd, args.target, args.pane, supervisor_pane, socket_path)
    if not target_pane:
        print("autoworker: 无法唯一确定目标 pane")
        print(f"reason: {reason}")
        for pane in candidates[:8]:
            print(f"- {pane['session_name']} {pane['pane_ref']} {pane['pane_id']} {pane['pane_current_command']} {pane['pane_current_path']}")
        return 2
    pane = next((p for p in candidates if p["pane_id"] == target_pane), None)
    if not pane:
        pane = next(p for p in list_panes(socket_path=socket_path) if p["pane_id"] == target_pane)
    state.update(
        {
            "enabled": True,
            "repo": str(cwd),
            "target_pane": target_pane,
            "target_session": pane.get("session_name"),
            "target_hint": args.target,
            "supervisor_pane": supervisor_pane,
            "supervisor_session": supervisor_session,
            "tmux_socket_path": socket_path,
            "dispatch_template": args.dispatch_template or state.get("dispatch_template") or DEFAULT_DISPATCH_TEMPLATE,
            "event_template": state.get("event_template") or DEFAULT_EVENT_TEMPLATE,
            "cooldown_ms": args.cooldown_ms,
            "stalled_timeout_ms": args.stalled_timeout_ms,
            "node_idle_stop_ms": args.node_idle_stop_ms,
            "poll_ms": args.poll_ms,
            "auto_fallback_after_ms": args.auto_fallback_after_ms,
            "updated_at": now_iso(),
            "last_reason": f"started:{reason}",
            "last_pane_signature": None,
            "last_change_at": now_iso(),
            "last_event_signature": None,
            "last_worker_state": "unknown",
            "pending_supervisor_action": False,
            "last_auto_dispatch_at": None,
            "auto_dispatch_count": 0,
        }
    )
    state = ensure_watcher(cwd, state, log_path)
    safe_write_json(state_path, state)
    print(f"autoworker: 已启动，worker={state['target_session']} {target_pane} supervisor={supervisor_session} {supervisor_pane}")
    print(f"watcher_pid: {state.get('watcher_pid')}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    _, _, state = load_state(Path(args.cwd).resolve())
    print_status(state)
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    state_path, _, state = load_state(cwd)
    if not state:
        print("autoworker: 未启用")
        return 0
    pid = state.get("watcher_pid")
    if process_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    state["enabled"] = False
    state["stopped_at"] = now_iso()
    state["last_reason"] = "stopped"
    safe_write_json(state_path, state)
    print("autoworker: 已停止")
    return 0


def cmd_retarget(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    state_path, log_path, state = load_state(cwd)
    if not state.get("enabled"):
        print("autoworker: 当前未启用，请先 start")
        return 1
    socket_path = state.get("tmux_socket_path") or resolve_tmux_socket()
    target_pane, candidates, reason = detect_candidates(cwd, args.target, args.pane, state.get("supervisor_pane"), socket_path)
    if not target_pane:
        print("autoworker: retarget 无法唯一确定目标")
        print(f"reason: {reason}")
        for pane in candidates[:8]:
            print(f"- {pane['session_name']} {pane['pane_ref']} {pane['pane_id']} {pane['pane_current_command']} {pane['pane_current_path']}")
        return 2
    pane = next((p for p in candidates if p["pane_id"] == target_pane), None)
    if not pane:
        pane = next(p for p in list_panes(socket_path=socket_path) if p["pane_id"] == target_pane)
    state.update({
        "target_pane": target_pane,
        "target_session": pane.get("session_name"),
        "target_hint": args.target,
        "updated_at": now_iso(),
        "last_reason": f"retarget:{reason}",
        "last_pane_signature": None,
        "last_change_at": now_iso(),
        "last_event_signature": None,
    })
    state = ensure_watcher(cwd, state, log_path)
    safe_write_json(state_path, state)
    print(f"autoworker: 已切换目标到 {state['target_session']} {target_pane}")
    return 0


def cmd_hook(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    state_path, log_path, state = load_state(cwd)
    if not state.get("enabled"):
        return 0
    socket_path = resolve_tmux_socket() or state.get("tmux_socket_path")
    state["last_hook_at"] = now_iso()
    if socket_path:
        state["tmux_socket_path"] = socket_path
    pane = current_pane(socket_path=socket_path)
    sess = current_session(socket_path=socket_path)
    if pane and pane != state.get("target_pane"):
        state["supervisor_pane"] = pane
    if sess and pane and pane != state.get("target_pane"):
        state["supervisor_session"] = sess
    state = ensure_watcher(cwd, state, log_path)
    safe_write_json(state_path, state)
    return 0


def _notify_supervisor_once(cwd: Path, state_path: Path, state: dict[str, Any], socket_path: str | None) -> int:
    worker_pane = state.get("target_pane")
    supervisor_pane = state.get("supervisor_pane")
    if not worker_pane or not supervisor_pane or worker_pane == supervisor_pane:
        state["last_reason"] = "stop-hook-missing-pane"
        state["updated_at"] = now_iso()
        safe_write_json(state_path, state)
        return 0
    panes = {p["pane_id"]: p for p in list_panes(socket_path=socket_path)}
    pane = panes.get(worker_pane)
    if not pane:
        state["last_reason"] = "stop-hook-target-missing"
        state["updated_at"] = now_iso()
        safe_write_json(state_path, state)
        return 0
    tail = capture_tail(worker_pane, socket_path=socket_path, lines=40)
    sig = signature_for(pane, tail)
    should_send, reason = should_notify_supervisor(state, pane, tail, sig)
    if should_send:
        message = build_event_message(state, reason, tail)
        send_prompt_to_pane(supervisor_pane, message, socket_path=socket_path, clear_input=False, submit_key_presses=2)
        state["last_event_at"] = now_iso()
        state["last_reason"] = reason
        state["event_count"] = int(state.get("event_count", 0)) + 1
        state["updated_at"] = now_iso()
        safe_write_json(state_path, state)
        print(f"[{now_iso()}] stop-hook->supervisor worker={worker_pane} reason={reason}", flush=True)
        return 0
    state["last_reason"] = reason
    state["updated_at"] = now_iso()
    safe_write_json(state_path, state)
    return 0


def cmd_stop_hook(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    state_path, _, state = load_state(cwd)
    if not state.get("enabled"):
        return 0
    socket_path = resolve_tmux_socket() or state.get("tmux_socket_path")
    current = current_pane(socket_path=socket_path)
    if current != state.get("target_pane"):
        return 0
    return _notify_supervisor_once(cwd, state_path, state, socket_path)


def build_batch_message(goal: str, steps: list[str], verify: list[str], stop_when: list[str] | None = None) -> str:
    lines = [f"当前阶段目标：{goal}", "", "这轮连续做以下几步，不到 blocker 不要停："]
    for i, step in enumerate(steps, start=1):
        lines.append(f"{i}. {step}")
    if verify:
        lines.extend(["", "只跑最小相关验证："])
        for item in verify:
            lines.append(f"- {item}")
    effective_stop = stop_when or ["这个 batch 完成", "出现明确 blocker", "验证失败且需要换路径"]
    lines.extend(["", "只有在以下情况才停："])
    for item in effective_stop:
        lines.append(f"- {item}")
    return "\n".join(lines)


def _dispatch_to_worker(cwd: Path, pane: str | None, message: str) -> int:
    state_path, _, state = load_state(cwd)
    if not state.get("enabled"):
        print("autoworker: 当前未启用")
        return 1
    socket_path = state.get("tmux_socket_path") or resolve_tmux_socket()
    target = pane or state.get("target_pane")
    if not target:
        print("autoworker: 没有可用 worker pane")
        return 1
    send_prompt_to_pane(target, message, socket_path=socket_path, clear_input=True, submit_key_presses=2)
    state["pending_supervisor_action"] = False
    state["last_event_signature"] = None
    state["last_worker_state"] = "running"
    state["last_reason"] = "dispatched-to-worker"
    state["updated_at"] = now_iso()
    safe_write_json(state_path, state)
    print(f"autoworker: 已向 worker {target} 下达指令")
    return 0


def cmd_dispatch(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    _, _, state = load_state(cwd)
    message = args.message or state.get("dispatch_template") or DEFAULT_DISPATCH_TEMPLATE
    return _dispatch_to_worker(cwd, args.pane, message)


def cmd_dispatch_batch(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    goal = (args.goal or '').strip()
    steps = [s.strip() for s in (args.step or []) if s.strip()]
    verify = [s.strip() for s in (args.verify or []) if s.strip()]
    stop_when = [s.strip() for s in (args.stop_when or []) if s.strip()]
    if not goal or not steps:
        print('autoworker: dispatch-batch 需要 --goal 和至少一个 --step')
        return 1
    message = build_batch_message(goal, steps, verify, stop_when)
    return _dispatch_to_worker(cwd, args.pane, message)


def should_notify_supervisor(state: dict[str, Any], pane: dict[str, str], tail: str, sig: str) -> tuple[bool, str]:
    now = int(time.time() * 1000)
    prev_sig = state.get("last_pane_signature")
    if sig != prev_sig:
        state["last_pane_signature"] = sig
        state["last_change_at"] = now_iso()
        state["target_current_command"] = pane["pane_current_command"]
    last_change_ms = parse_iso_ms(state.get("last_change_at")) or now

    tail_l = tail.lower()
    interrupted = "conversation interrupted" in tail_l or "tell the model what to do differently" in tail_l
    prompt_like = any(line.strip().startswith("› ") for line in tail.splitlines()[-12:])
    active_work_markers = [
        'background terminal running',
        'waiting for background terminal',
        '• working (',
        'working (',
        'esc to interrupt',
    ]
    node_still_working = any(marker in tail_l for marker in active_work_markers)

    current_state = "running"
    stop_reason = ""
    if pane["pane_current_command"] == "node":
        if (interrupted or prompt_like) and not node_still_working:
            current_state = "stopped"
            stop_reason = "worker-stopped"
        elif not node_still_working and now - last_change_ms >= int(state.get("node_idle_stop_ms", DEFAULT_NODE_IDLE_STOP_MS)):
            current_state = "stopped"
            stop_reason = "worker-idle-node"
        else:
            current_state = "running"
    elif pane["pane_current_command"] in SHELL_COMMANDS:
        if interrupted or prompt_like:
            current_state = "stopped"
            stop_reason = "worker-shell-ready"
        else:
            stalled_timeout_ms = int(state.get("stalled_timeout_ms", 300000))
            if now - last_change_ms >= stalled_timeout_ms:
                current_state = "stopped"
                stop_reason = "worker-idle-shell"
            else:
                current_state = "running"
    else:
        current_state = "running"

    previous_state = state.get("last_worker_state", "unknown")
    state["last_worker_state"] = current_state

    if current_state == "running":
        if previous_state == "stopped":
            state["pending_supervisor_action"] = False
            state["last_event_signature"] = None
        return False, f"worker-busy:{pane['pane_current_command']}"

    if state.get("pending_supervisor_action"):
        return False, "awaiting-supervisor"

    cooldown_ms = int(state.get("cooldown_ms", 15000))
    last_event_iso = state.get("last_event_at")
    if last_event_iso:
        try:
            last_event_ms = int(datetime.fromisoformat(last_event_iso.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            last_event_ms = 0
        if now - last_event_ms < cooldown_ms:
            return False, "cooldown"

    event_sig = hashlib.sha256((sig + "|" + pane["pane_current_command"] + "|" + current_state + "|" + stop_reason).encode()).hexdigest()
    if state.get("last_event_signature") == event_sig:
        return False, "event-already-sent"

    if previous_state != "stopped" and current_state == "stopped":
        state["last_event_signature"] = event_sig
        state["pending_supervisor_action"] = True
        return True, stop_reason or "worker-stopped"

    return False, "worker-still-stopped"


def parse_iso_ms(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def maybe_auto_dispatch(
    state: dict[str, Any],
    state_path: Path,
    socket_path: str | None,
    worker_pane: str,
    reason: str,
) -> bool:
    if reason != "awaiting-supervisor":
        return False
    if not state.get("pending_supervisor_action"):
        return False
    if state.get("last_worker_state") != "stopped":
        return False
    last_event_ms = parse_iso_ms(state.get("last_event_at"))
    if last_event_ms is None:
        return False
    auto_after_ms = int(state.get("auto_fallback_after_ms", DEFAULT_AUTO_FALLBACK_AFTER_MS))
    now = int(time.time() * 1000)
    if now - last_event_ms < auto_after_ms:
        return False

    message = state.get("dispatch_template") or DEFAULT_DISPATCH_TEMPLATE
    send_prompt_to_pane(worker_pane, message, socket_path=socket_path, clear_input=True, submit_key_presses=2)
    state["pending_supervisor_action"] = False
    state["last_event_signature"] = None
    state["last_worker_state"] = "running"
    state["last_reason"] = "auto-fallback-dispatch"
    state["last_auto_dispatch_at"] = now_iso()
    state["auto_dispatch_count"] = int(state.get("auto_dispatch_count", 0)) + 1
    state["updated_at"] = now_iso()
    safe_write_json(state_path, state)
    print(
        f"[{now_iso()}] auto-dispatch->worker worker={worker_pane} reason=pending-timeout",
        flush=True,
    )
    return True


def build_event_message(state: dict[str, Any], reason: str, tail: str) -> str:
    tail_text = tail_excerpt(tail)
    template = state.get("event_template") or DEFAULT_EVENT_TEMPLATE
    return template.format(
        worker_session=state.get("target_session") or "",
        worker_pane=state.get("target_pane") or "",
        reason=reason,
        cwd=state.get("repo") or "",
        tail=tail_text,
    )


def cmd_watch(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    state_path, _, state = load_state(cwd)
    if not state.get("enabled"):
        return 0
    socket_path = args.socket or state.get("tmux_socket_path") or resolve_tmux_socket()
    while True:
        state = safe_read_json(state_path, default={}) or {}
        if not state.get("enabled"):
            return 0
        socket_path = state.get("tmux_socket_path") or socket_path or resolve_tmux_socket()
        if not socket_path:
            state["last_reason"] = "tmux-socket-missing"
            state["updated_at"] = now_iso()
            safe_write_json(state_path, state)
            time.sleep(max(1, int(state.get("poll_ms", 15000)) / 1000))
            continue
        try:
            panes = {p["pane_id"]: p for p in list_panes(socket_path=socket_path)}
        except Exception as exc:
            state["last_reason"] = f"tmux-error:{exc}"
            state["updated_at"] = now_iso()
            safe_write_json(state_path, state)
            time.sleep(max(1, int(state.get("poll_ms", 15000)) / 1000))
            continue
        worker_pane = state.get("target_pane")
        supervisor_pane = state.get("supervisor_pane")
        pane = panes.get(worker_pane)
        if not pane:
            state["last_reason"] = "target-missing"
            state["updated_at"] = now_iso()
            safe_write_json(state_path, state)
            time.sleep(max(1, int(state.get("poll_ms", 15000)) / 1000))
            continue
        if not supervisor_pane or supervisor_pane == worker_pane:
            state["last_reason"] = "supervisor-missing"
            state["updated_at"] = now_iso()
            safe_write_json(state_path, state)
            time.sleep(max(1, int(state.get("poll_ms", 15000)) / 1000))
            continue
        tail = capture_tail(worker_pane, socket_path=socket_path, lines=40)
        sig = signature_for(pane, tail)
        should_send, reason = should_notify_supervisor(state, pane, tail, sig)
        if should_send:
            message = build_event_message(state, reason, tail)
            send_prompt_to_pane(supervisor_pane, message, socket_path=socket_path, clear_input=False, submit_key_presses=2)
            state["last_event_at"] = now_iso()
            state["last_reason"] = reason
            state["event_count"] = int(state.get("event_count", 0)) + 1
            state["updated_at"] = now_iso()
            safe_write_json(state_path, state)
            print(f"[{now_iso()}] event->supervisor worker={worker_pane} reason={reason}", flush=True)
        else:
            if maybe_auto_dispatch(state, state_path, socket_path, worker_pane, reason):
                time.sleep(max(1, int(state.get("poll_ms", 15000)) / 1000))
                continue
            state["last_reason"] = reason
            state["updated_at"] = now_iso()
            safe_write_json(state_path, state)
        time.sleep(max(1, int(state.get("poll_ms", 15000)) / 1000))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="autoworker supervisor/watchdog")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ["start", "status", "stop", "retarget", "hook", "stop-hook", "watch", "dispatch", "dispatch-batch"]:
        sp = sub.add_parser(name)
        sp.add_argument("--cwd", default=os.getcwd())
        if name in {"start", "retarget"}:
            sp.add_argument("--target", default=None)
            sp.add_argument("--pane", default=None)
        if name == "start":
            sp.add_argument("--dispatch-template", default=None)
            sp.add_argument("--cooldown-ms", type=int, default=15000)
            sp.add_argument("--stalled-timeout-ms", type=int, default=300000)
            sp.add_argument("--node-idle-stop-ms", type=int, default=DEFAULT_NODE_IDLE_STOP_MS)
            sp.add_argument("--poll-ms", type=int, default=15000)
            sp.add_argument("--auto-fallback-after-ms", type=int, default=DEFAULT_AUTO_FALLBACK_AFTER_MS)
        if name == "watch":
            sp.add_argument("--socket", default=None)
        if name == "dispatch":
            sp.add_argument("--pane", default=None)
            sp.add_argument("--message", default=None)
        if name == "dispatch-batch":
            sp.add_argument("--pane", default=None)
            sp.add_argument("--goal", default=None)
            sp.add_argument("--step", action='append', default=[])
            sp.add_argument("--verify", action='append', default=[])
            sp.add_argument("--stop-when", action='append', default=[])
    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.cmd == "start":
            return cmd_start(args)
        if args.cmd == "status":
            return cmd_status(args)
        if args.cmd == "stop":
            return cmd_stop(args)
        if args.cmd == "retarget":
            return cmd_retarget(args)
        if args.cmd == "hook":
            return cmd_hook(args)
        if args.cmd == "stop-hook":
            return cmd_stop_hook(args)
        if args.cmd == "watch":
            return cmd_watch(args)
        if args.cmd == "dispatch":
            return cmd_dispatch(args)
        if args.cmd == "dispatch-batch":
            return cmd_dispatch_batch(args)
    except Exception as exc:
        print(f"autoworker error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
