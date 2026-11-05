# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- nothing yet

## [0.1.2] - 2026-11-05

### Added
- Replay forwards request headers on record-mode misses (from the request shape or the `headers` option), so authenticated requests land on the tape.
- Stub mode answers a matching interaction from the tape; the deterministic 599 is only the miss fallback.

### Fixed
- Header redaction covers any header whose name mentions a credential (`x-api-key`, `session-token`, ...), not just the four fixed names.
- URL userinfo is stripped before interactions are stored, and `NoMatchError` messages carry origin and path only - no query string.
- `Buffer` request bodies are sent as raw bytes and stored as `null` instead of a lossy rewrite.
- Tape validation enforces integer HTTP status codes 100..599, and `saveTape` refuses to persist an invalid tape.
- The CLI entry resolves through `realpathSync`, so a symlinked bin still detects the main module.

## [0.1.1] - 2026-11-05

### Fixed

- The `httptape` bin ships with a shebang, so global installs work on Unix.
- Recording settles on response errors and enforces an absolute timeout instead of hanging forever.
- Tape matching compares HTTP methods case-insensitively.
- Replay consumption is keyed by the resolved tape path, so `./a.json` and `a.json` share one tape.
- `saveTape` writes atomically (temp file + rename).

## [0.1.0] - 2026-11-05

### Added

- Initial release: HTTP record/replay test library with `formatVersion=1` tape files, three replay modes, and redaction of credential headers.