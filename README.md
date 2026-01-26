# apply-to-qti-results

Tooling for updating QTI 3.0 Results Reporting documents using scoring rubrics
from QTI 3.0 item sources.

## Documents
- Scoring update specification: [docs/scoring-update-spec.md](docs/scoring-update-spec.md)
- Scoring input schema: [docs/scoring-update-input.schema.json](docs/scoring-update-input.schema.json)

## Test cases
Data-only fixtures live under [test/test-cases](test/test-cases).

## Tests
Run the data-only test runner:

```sh
npm test
```

The runner invokes the scoring update implementation via an external command.

### Implementation command

The test runner invokes the CLI at `test/stub/apply-qti-results.ts`, which
forwards to the implementation in `src/cli.ts`.

For local usage, you can run:

```sh
npm run apply-results -- --results <results.xml> --assessment-test <assessment-test.qti.xml> --scoring <scoring.json> [--preserve-met]
```

On success, the command overwrites the results XML file in place.

When results and scoring file names differ, use regex mapping:

```sh
npm run apply-results -- --results "results/assessmentResult-*.xml" --assessment-test <assessment-test.qti.xml> --scoring "updates/scoring-update-input-*.json" --results-regex "assessmentResult-(?<id>\\d+)\\.xml" --scoring-template "scoring-update-input-{id}.json"
```

## Inputs

### `--results`
QTI 3.0 Results Reporting XML with `assessmentResult` as the root element.
This file is the target that will be updated. Example fixture:
[`test/test-cases/basic/results.input.xml`](test/test-cases/basic/results.input.xml).

`--results` also accepts glob patterns (`*`, `**`, `?`) to target multiple
results files. When a glob is used, the CLI processes all matches in
deterministic order and stops on the first failure. Example layout:
[`test/test-cases/glob-basic`](test/test-cases/glob-basic).
When combined with `--results-regex` and `--scoring-template`, the regex is
applied to the results relative path from the glob root. Example:
[`test/test-cases/glob-regex-basic`](test/test-cases/glob-regex-basic).

### `--assessment-test`
QTI 3.0 Assessment Test XML with `qti-assessment-test` as the root element.
The test must reference item files via `qti-assessment-item-ref` entries with
relative `href` values. Example fixture:
[`test/test-cases/basic/assessment-test.qti.xml`](test/test-cases/basic/assessment-test.qti.xml).
This file is expected to follow the assessment-test mapping format produced by
`markdown-to-qti` (see `D:\\siw-workspace\\markdown-to-qti\\docs\\qti-mapping.md`).

### `--scoring`
JSON input that matches [`docs/scoring-update-input.schema.json`](docs/scoring-update-input.schema.json).
Example fixture: [`test/test-cases/basic/scoring.json`](test/test-cases/basic/scoring.json).

Scoring item entries can include `comment` to store a per-item comment in the
results output. If `comment` is provided without `criteria`, only the comment
is updated.
The tool always recomputes the test-level `SCORE` using all item-level `SCORE`
values present in the results after the update, including items that were not
included in the scoring input.

`--scoring` also accepts glob patterns when `--results` is a glob. The tool
matches results and scoring files by **relative path without the extension**,
using the glob root directory as the base. For example, `results/classA/a.xml`
matches `scoring/classA/a.json`.
If `--results` expands to multiple files, `--scoring` must also be a glob.
Matching is case-insensitive.
When regex mapping is enabled, `--scoring` defines the scoring root directory
and `--scoring-template` resolves scoring paths relative to that root.

### `--results-regex` (optional)
Regular expression applied to each results relative path (from the results glob
root, using forward slashes). The regex must match the entire relative path and
is case-insensitive. This option requires `--scoring-template`.

Named capture groups and numbered capture groups can be referenced from the
scoring template. Example:
[`test/test-cases/glob-regex-basic`](test/test-cases/glob-regex-basic).

### `--scoring-template` (optional)
Template used to resolve scoring paths when `--results-regex` is provided. The
template is resolved relative to the scoring glob root. Supported tokens:
This option requires `--results-regex`.

- `{path}`, `{dir}`, `{base}`, `{ext}`
- `{1}`, `{2}`, ... (numbered capture groups)
- `{name}` (named capture groups)

### `--preserve-met` (optional)
When enabled, existing `RUBRIC_<n>_MET=true` values in the results XML are never
downgraded to `false`. The item-level and test-level `SCORE` are calculated
using the preserved rubric outcomes.
If a downgrade is prevented, the CLI writes a warning to stderr.

The CLI must accept the following arguments:

- `--results <path|glob>`: results input XML (or glob).
- `--assessment-test <path>`: assessment test XML that references item files.
- `--scoring <path|glob>`: scoring input JSON (or glob when results is a glob).
- `--results-regex <pattern>`: optional regex mapping for results paths.
- `--scoring-template <template>`: optional scoring template used with `--results-regex`.
- `--preserve-met`: optional flag to prevent `true` → `false` rubric downgrades.

The CLI must write to stdout:

- On success: nothing (the results file is updated in place), exit code `0`.
- On error: a JSON object matching the `expected-error.json` shape, exit code non-zero,
  and the results file remains unchanged.
