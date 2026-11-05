# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- nothing yet

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
