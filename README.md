# autoworker

> 语言 / Language：**简体中文** · [English](./README.en.md)

`autoworker` 是一个 **基于 OMX + Codex + tmux** 的监督增强层，用来让一个 supervisor 会话自动监督另一个 code/worker 会话，在 worker 停住时接管判断并继续驱动。

它**不是** `oh-my-codex` 的替代品，而是运行在 OMX 之上的增强层。

## 当前支持范围

当前 v0 只支持：

- `oh-my-codex` / `omx`
- Codex
- tmux 工作流

当前**不支持**：

- Claude Code
- 非 tmux 工作流
- 非 OMX 环境

## 前置依赖

使用 `autoworker` 前，你必须已经安装：

- `oh-my-codex`，且 `omx` 在 `PATH` 中可用
- Codex
- tmux

## 安装

```bash
npx autoworker setup
```

安装器会：

- 安装主技能到 `~/.codex/skills/autoworker`
- 把 `~/.codex/hooks.json` 收口为 `autoworker` 主入口
- 安装技能内 stop wrapper，避免 supervisor 会话被 worker 的 Ralph 状态误拦

## 命令

```bash
autoworker
autoworker launch
autoworker setup
autoworker doctor
autoworker status
autoworker uninstall
```

默认直接执行 `autoworker` 时，会以当前目录为 `cwd` 创建或复用一个 tmux session，并在主 window 中准备两个 pane：

- `planner` pane
- `worker` pane

当前终端会默认进入 `planner` pane，`worker` 会同时就绪并可在同屏切换。

对应的 Codex thread name 会稳定使用：

- `<dirname>-planner`
- `<dirname>-worker`

`autoworker` 会优先选择可用的较新 Codex CLI，并在启动输出里显示 `codex_bin` / `codex_version`。如需强制指定，可设置：

```bash
AUTOWORKER_CODEX_BIN=/path/to/codex autoworker
```

Codex 启动时默认加 `--no-alt-screen`，避免 tmux 里滚动体验被备用屏幕打断。

tmux 交互建议：

- autoworker session 会开启 `mouse on`，便于在 macOS 终端里直接点选 pane、滚轮查看历史。
- 键盘切 pane 可用 tmux 默认前缀：`Ctrl-b` 后按方向键。
- 滚动可用鼠标滚轮，或 `Ctrl-b` 后按 `[` 进入 copy-mode，再用方向键/PageUp/PageDown 查看。

## Stop hook 行为

`autoworker` 自带技能内 stop wrapper：

- `planner` pane 会直接放行 stop
- `worker` pane 会继续交给 OMX native stop hook
- wrapper 优先读取当前 tmux session env 中的 pane-first 字段判断角色

## 开发与验证

最小 smoke：

```bash
npm test
```

仓库内的轻量 smoke 测试源码位于 `src/__tests__/`，通过 TypeScript 编译到 `dist/__tests__/` 后直接用 Node 执行。

## 发布

仓库自带：

- CI：push / pull_request
- 发布：推送 semver tag（例如 `v0.1.0`）时发布 npm
