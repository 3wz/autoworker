# Repository Guidelines

## Project Structure & Module Organization
`bin/autoworker.js` is the published CLI entrypoint. Keep TypeScript command handlers in `src/cli/` and shared installer logic in `src/install/`. Ship the skill payload from `assets/skill-autoworker`; it is copied into `~/.codex/skills/` during setup. Build output goes to `dist/`, and `scripts/smoke-install.mjs` covers installer regressions. CI and release automation live in `.github/workflows/`.

## Build, Test, and Development Commands
Run `npm install` with Node 20+ before local work. Use `npm test` or `npm run smoke:install` to exercise the install flow against a temporary `CODEX_HOME` and a stub `omx` binary; both build `dist/` first. Run `npm pack --dry-run` before merging changes that affect packaging, assets, or `files` in `package.json`; CI runs the same check. For quick CLI validation, run `npm run build` and then `node bin/autoworker.js help`.

## Coding Style & Naming Conventions
This repository uses Node ESM with TypeScript, so keep source files in `src/` as `.ts`. Match the existing style: 2-space indentation, single quotes, semicolons, and small focused functions. Name CLI modules after the command they implement and prefer explicit named exports such as `setupCommand`. Reuse helpers in `src/install/common.ts` before adding new install logic.

## Testing Guidelines
The smoke installer is the primary regression test. When setup, hook patching, or asset copy behavior changes, extend `scripts/smoke-install.mjs` with concrete file existence or command-output assertions. Keep tests isolated with temporary directories and environment variables like `CODEX_HOME`; do not rely on a real local OMX state.

## Commit & Pull Request Guidelines
Recent history uses short, imperative, intent-first subjects such as `Normalize autoworker as the single active hook entrypoint`. Follow the repo's Lore commit protocol when committing: start with the reason for the change, then add trailers like `Constraint:`, `Confidence:`, `Scope-risk:`, and `Tested:` where useful. Pull requests should summarize the behavioral change, list verification commands run, and call out any impact on OMX, Codex, tmux, or install paths. Prefer terminal output snippets over screenshots for CLI changes.

## Configuration Notes
`.omx/` is local runtime state and should stay untracked. Avoid hardcoding machine-specific paths except for intentional `~/.codex` install targets, and keep new dependencies out unless they are clearly necessary.
