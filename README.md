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

The test runner invokes the stub CLI at
`test/stub/apply-qti-results.js`, which always returns a `not implemented`
error. When the real implementation is ready, replace that file with your
implementation (or a thin wrapper that calls it).

The CLI must accept the following arguments:

- `--results <path>`: results input XML.
- `--item <path>`: item source XML (repeatable).
- `--scoring <path>`: scoring input JSON.

The CLI must write to stdout:

- On success: the updated results XML, exit code `0`.
- On error: a JSON object matching the `expected-error.json` shape, exit code non-zero.
