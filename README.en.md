# autoworker

> Language / 语言: [简体中文](./README.md) · **English**

`autoworker` is an **OMX + Codex + tmux** supervision layer for long-running worker sessions.

It is **not** a replacement for `oh-my-codex`; it sits on top of OMX and adds stop detection, supervisor notification, fallback dispatch, and stop-hook scoping so supervisor sessions are not incorrectly blocked by worker-side Ralph state.

## Current support

Current v0 supports only:

- `oh-my-codex` / `omx`
- Codex
- tmux workflows

It does **not** currently support Claude Code, non-tmux workflows, or non-OMX environments.

## Prerequisites

Before using `autoworker`, you must already have:

- `oh-my-codex` installed and `omx` available in `PATH`
- Codex installed
- tmux available

## Install

```bash
npx @shuian/autoworker setup
```

The installer will:

- install the primary skill into `~/.codex/skills/autoworker`
- normalize `~/.codex/hooks.json` to the `autoworker` entrypoints
- install a skill-local stop wrapper so supervisor sessions are not blocked by worker Ralph state

## Commands

```bash
autoworker
autoworker launch
autoworker setup
autoworker doctor
autoworker status
autoworker uninstall
```

Running `autoworker` with no arguments now defaults to launch mode. It uses the current directory as `cwd` and creates or reuses a single tmux session with two panes:

- `planner` pane
- `worker` pane

The current terminal enters the `planner` pane by default, while the `worker` pane is ready in the same tmux view.

The Codex thread names stay stable as:

- `<dirname>-planner`
- `<dirname>-worker`

`autoworker` prefers the newest available Codex CLI it can find and prints `codex_bin` / `codex_version` during launch. Override explicitly with:

```bash
AUTOWORKER_CODEX_BIN=/path/to/codex autoworker
```

Codex is launched with `--no-alt-screen` by default so tmux scrollback remains usable.

tmux interaction tips:

- The autoworker session enables `mouse on`, so macOS terminals can click panes and scroll history with the mouse.
- Use the default tmux prefix `Ctrl-b` plus arrow keys to switch panes from the keyboard.
- Scroll with the mouse wheel, or press `Ctrl-b` then `[` to enter copy-mode and use arrows/PageUp/PageDown.

## Stop hook behavior

`autoworker` installs a skill-local stop wrapper:

- the `planner` pane is allowed to stop directly
- the `worker` pane still goes through the OMX native stop hook
- the wrapper reads pane-first role data from tmux session env
- runtime state and logs are written under the repo-local `.autoworker/`

## Development

Minimal smoke test:

```bash
npm test
```

The lightweight smoke tests live under `src/__tests__/` and run as compiled TypeScript output from `dist/__tests__/`.

## Release

This repo includes:

- CI on push / pull_request
- npm publish for `@shuian/autoworker` plus GitHub Release creation on semver tag pushes such as `v0.1.0`
