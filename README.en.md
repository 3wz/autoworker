# autoworker

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
npx autoworker setup
```

The installer will:

- install the primary skill into `~/.codex/skills/autoworker`
- install the compatibility alias into `~/.codex/skills/autocode`
- normalize `~/.codex/hooks.json` to the `autoworker` entrypoints
- install a skill-local stop wrapper so supervisor sessions are not blocked by worker Ralph state

## Commands

```bash
autoworker setup
autoworker doctor
autoworker status
autoworker uninstall
```

## Compatibility

- Primary name: `autoworker`
- Compatibility alias: `autocode`

The old `autocode` prompt/skill entry remains available, but `autoworker` is the canonical public name.

## Stop hook behavior

`autoworker` installs a skill-local stop wrapper:

- worker/code sessions still go through the OMX native stop block
- supervisor/plan sessions are allowed to stop
- dirty state like `active=true` with `completed_at` can be normalized by wrapper/doctor paths

## Development

Minimal smoke test:

```bash
npm run smoke:install
```

## Release

This repo includes:

- CI on push / pull_request
- npm publish on semver tag pushes such as `v0.1.0`
