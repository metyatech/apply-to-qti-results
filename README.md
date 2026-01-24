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

The runner applies a reference implementation to the fixtures and compares
against expected outputs or expected errors.
