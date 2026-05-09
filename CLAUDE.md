# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension ("Peek Files") that underlines filename-like tokens in the active editor when a matching file exists in the workspace, and lets the user peek into the closest matching file via `Cmd+Alt+P` / `Alt+Cmd+Click`.

## Commands

- `npm run watch` — webpack watch build into `dist/extension.js` (used while developing in the Extension Development Host; launch it via VS Code's "Run Extension" debug config in [.vscode/launch.json](.vscode/launch.json)).
- `npm run compile` / `npm run package` — one-shot dev / production webpack build.
- `npm run lint` — eslint over `src/`.
- `npm test` — runs `pretest` (compiles tests via `tsc` to `out/`, runs the webpack build, lints) and then `vscode-test`, which downloads VS Code and executes `out/test/**/*.test.js` ([.vscode-test.mjs](.vscode-test.mjs)).
- `npm run compile-tests` — only compile tests (no extension build, no lint). Useful when iterating on tests.
- `vsce package` / `vsce publish` — build `.vsix` / publish to the marketplace.

Note: `tsc` is configured with `rootDir: src` ([tsconfig.json](tsconfig.json)) and outputs to `out/` only for tests; the shipped extension is bundled by webpack into `dist/extension.js` (entry declared in [package.json](package.json) `main`).

## Architecture

The whole extension lives in [src/extension.ts](src/extension.ts). Two regex-driven flows drive everything:

1. **Decoration pass** (`updateDecorations`) — runs on activation, editor switch, and document change. It scans the visible document with `fileRegex` (built from `peekFiles.fileExtensions`), collects every basename, and calls `vscode.workspace.findFiles('**/<basename>', '**/node_modules/**', 10)` per unique basename. Any match whose basename is found anywhere in the workspace gets an underline decoration. Matching is **basename-only** — relative path components in the source token are ignored for the existence check.

2. **Peek / Go-to-definition** (`peekFileCommand` + `provideDefinition`) — both share `findClosestFile`, which fetches up to 50 workspace matches for a basename and ranks them with `pathDistance`. The cost model: walking *down* into a subdirectory costs 1 per segment; walking *up* to a parent costs `peekFiles.parentTraversalCost` (default 1000) per segment. This strongly biases resolution toward files reachable by descending from the current file's directory. Peek opens at line 0 via `editor.action.peekLocations`.

Two regexes intentionally differ:
- `filenameRegex` (used by peek/definition via `getWordRangeAtPosition`) matches *any* extension — so the user can peek a token VS Code didn't underline.
- `fileRegex` (used by decorations) is restricted to `peekFiles.fileExtensions` to keep the decoration scan cheap.

Configuration is loaded in `activate` and refreshed via `vscode.workspace.onDidChangeConfiguration`, so edits to `peekFiles.*` settings take effect on the next decoration / peek without a window reload.
