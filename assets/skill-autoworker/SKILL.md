---
name: autoworker
description: 当用户说“autoworker”或希望自动监督另一个 code 会话、在它停住时先通知当前 supervisor 会话，再由当前会话继续驱动 worker 开发时使用。当前只支持 OMX + Codex + tmux。
---

# autoworker

`autoworker` 是一个基于 OMX 的轻量监督技能：
- 它不替代 ralph / team；
- 它把当前会话作为 **supervisor**；
- 把另一个 code 会话作为 **worker**；
- 当 worker 停住时，先向当前 supervisor 会话发送 `AUTOWORKER_EVENT`；
- 然后由当前会话决定下一步，再用脚本把命令发回 worker。

## 当前支持范围

当前只支持：
- OMX
- Codex
- tmux

## 使用方式

```bash
python3 scripts/autoworker.py start --cwd "$PWD"
python3 scripts/autoworker.py start --cwd "$PWD" --target gamepilot-code
python3 scripts/autoworker.py start --cwd "$PWD" --pane %3
python3 scripts/autoworker.py status --cwd "$PWD"
python3 scripts/autoworker.py stop --cwd "$PWD"
python3 scripts/autoworker.py retarget --cwd "$PWD" --target gamepilot-code
python3 scripts/autoworker.py dispatch --cwd "$PWD" --message "继续执行..."
python3 scripts/autoworker.py dispatch-batch --cwd "$PWD" --goal "..." --step "..." --step "..." --verify "..."
```

## Stop hook 说明

`autoworker` 自带一个技能内 stop wrapper：

- `scripts/omx-stop-wrapper.py`

用途：
- 只在真正的 worker/code 会话上保留 OMX 原生 stop block；
- 对 supervisor/plan 会话直接放行，避免 repo 里 active ralph 误拦当前监督会话；
- 这样升级 OMX 插件时不会因为改了插件源码而丢失修复。
