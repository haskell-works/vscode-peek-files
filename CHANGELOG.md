# Change Log

All notable changes to the "peek-files" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.0] - 2026-05-10

### Added

- Configurable `peekFiles.exclude` glob to override the file-search exclusion pattern; when null, VS Code's `files.exclude` and `search.exclude` apply (#5).
- `peekFiles.indexMode` setting (`on`/`off`) to toggle the in-memory basename index (#4).
- Reactive configuration: edits to `peekFiles.*` settings take effect immediately without a window reload (#8).
- `CLAUDE.md` with project guidance for AI assistants (#1).

### Changed

- Decoration scan now uses an in-memory `BasenameIndex` kept in sync via a `FileSystemWatcher`, eliminating ripgrep invocations from the keystroke path (#4).
- Decoration scan is visible-range-aware: only the lines currently in the viewport are resolved, with results cached and gaps computed incrementally on scroll. Files under 500 lines are still scanned in full (#6).
- Decoration updates are debounced (200ms) and cancellable; stale scans abort when the document changes or closes.

### Fixed

- Decoration fan-out: per-basename `findFiles` calls are replaced with batched brace-glob patterns chunked to fit the OS argv budget (#2).

## [0.0.1]

- Initial release