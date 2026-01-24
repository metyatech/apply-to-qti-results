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
npm run apply-results -- --results <results.xml> --item <item.xml> --scoring <scoring.json> [--preserve-met]
```

## Inputs

### `--results`
QTI 3.0 Results Reporting XML with `assessmentResult` as the root element.
This file is the target that will be updated. Example fixture:
[`test/test-cases/basic/results.input.xml`](test/test-cases/basic/results.input.xml).

### `--item`
QTI 3.0 Item XML with `qti-assessment-item` as the root element. The item must
contain a scorer rubric in `qti-rubric-block view="scorer"` with rubric lines
formatted as `[<points>] <criterion>`. Example fixture:
[`test/test-cases/basic/item-source.xml`](test/test-cases/basic/item-source.xml).
You can pass multiple `--item` flags.

### `--scoring`
JSON input that matches [`docs/scoring-update-input.schema.json`](docs/scoring-update-input.schema.json).
Example fixture: [`test/test-cases/basic/scoring.json`](test/test-cases/basic/scoring.json).

### `--preserve-met` (optional)
When enabled, existing `RUBRIC_<n>_MET=true` values in the results XML are never
downgraded to `false`. The item-level and test-level `SCORE` are calculated
using the preserved rubric outcomes.
If a downgrade is prevented, the CLI writes a warning to stderr.

The CLI must accept the following arguments:

- `--results <path>`: results input XML.
- `--item <path>`: item source XML (repeatable).
- `--scoring <path>`: scoring input JSON.

The CLI must write to stdout:

- On success: the updated results XML, exit code `0`.
- On error: a JSON object matching the `expected-error.json` shape, exit code non-zero.
