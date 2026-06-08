# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Objective auto-scored items (sources declaring `qti-correct-response`, i.e.
  choice and cloze questions) no longer have their `SCORE` or `RUBRIC_<n>_MET`
  outcomes overwritten by scoring-input `criteria`. The delivery system's
  deterministic auto-score is preserved; only descriptive items are graded from
  the scorer rubric. Per-item `comment` values are still applied.

## [0.1.0] - 2026-02-06

### Added

- Initial setup with ESM and TypeScript.
- ESLint and Prettier configurations.
- GitHub Actions CI workflow.
- Standard project documentation (LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT).

### Changed

- Improved TypeScript types and ESM compatibility.
