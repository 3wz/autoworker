# autoworker

`autoworker` is an **OMX + Codex** supervision layer for tmux-based worker sessions.

It is **not** a replacement for `oh-my-codex`.
It sits on top of OMX and adds:

- worker stop detection
- supervisor notification
- auto fallback dispatch
- stop-hook scoping so supervisor sessions are not incorrectly blocked by worker-side Ralph state
- a compatibility alias for older `autocode` users

## Current support

Current v0 only supports:

- `oh-my-codex` / `omx`
- Codex
- tmux workflows

It does **not** currently target Claude Code, non-tmux workflows, or non-OMX environments.

## Prerequisites

Before using `autoworker`, you must already have:

- `oh-my-codex` installed and `omx` available in `PATH`
- Codex installed
- tmux available

## Install

```bash
npx autoworker setup
```

This will:

- install `autoworker` skill files into `~/.codex/skills/autoworker`
- install an `autocode` compatibility alias into `~/.codex/skills/autocode`
- update `~/.codex/hooks.json` so Stop / SessionStart / UserPromptSubmit use `autoworker`

## Commands

```bash
autoworker setup
autoworker doctor
autoworker status
autoworker uninstall
```

## Compatibility

`autoworker` is the primary name.

`autocode` remains available as a compatibility alias so old prompts and local habits keep working.

## Stop hook behavior

`autoworker` installs a skill-local stop wrapper:

- worker/code sessions still go through the OMX stop block
- supervisor/plan sessions are allowed to stop
- dirty state like `active=true` plus `completed_at` can be normalized by the wrapper/doctor flow

## Development

Minimal repo smoke test:

```bash
npm run smoke:install
```

## Release

This repo uses:

- CI on push / PR
- npm publish on semver tag pushes like `v0.1.0`
