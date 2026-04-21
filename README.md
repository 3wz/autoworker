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

默认直接执行 `autoworker` 时，会以当前目录为 `cwd` 创建或复用两个 tmux session：

- `planner`
- `worker`

如果 session 已存在，不会销毁，只会复用并输出 `created` / `reused` 状态。

## Stop hook 行为

`autoworker` 自带技能内 stop wrapper：

- worker/code 会话仍然保留 OMX 原生 stop block
- supervisor/plan 会话直接放行
- 脏 state（例如 `active=true` 且已有 `completed_at`）可由 wrapper/doctor 路径进一步治理

## 开发与验证

最小 smoke：

```bash
npm run smoke:install
```

## 发布

仓库自带：

- CI：push / pull_request
- 发布：推送 semver tag（例如 `v0.1.0`）时发布 npm
