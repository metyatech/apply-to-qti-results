# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Replaced the generic `autoScored` check with question-type-aware logic (`choice`, `cloze`, `descriptive`).
- Choice items (`qti-choice-interaction`) ignore scoring `criteria` entirely, preserving the delivery system's auto-score.
- Cloze items (`qti-text-entry-interaction`) apply an unconditional OR-invariance for scoring criteria, allowing upward corrections (× → ○) but preventing downgrades (○ → ×). The item-level `SCORE` is guaranteed never to decrease.
- Descriptive items continue to use the existing behavior, respecting the `--preserve-met` flag.

## [0.1.0] - 2026-02-06

### Added

- Initial setup with ESM and TypeScript.
- ESLint and Prettier configurations.
- GitHub Actions CI workflow.
- Standard project documentation (LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT).

### Changed

- Improved TypeScript types and ESM compatibility.
