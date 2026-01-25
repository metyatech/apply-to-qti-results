# QTI 3.0 Results Scoring Update Specification

## Purpose
Define how this tool adds or updates scoring results in QTI 3.0 Results Reporting
based on a scoring rubric contained in a separate QTI 3.0 item document.

The tool only uses standard QTI Results Reporting elements. It adds a limited set
of tool-defined outcome variables for rubric evaluation results and preserves all
other custom data as-is.

## Inputs
- **Results document**: QTI 3.0 Results Reporting XML (`assessmentResult`).
- **Assessment test**: QTI 3.0 assessment test XML (`qti-assessment-test`) that
  references item files via `qti-assessment-item-ref`.
- **Item sources**: QTI 3.0 item XML (`qti-assessment-item`) referenced by the
  assessment test and containing scoring rubrics.
- **Scoring updates**: JSON that conforms to
  [`scoring-update-input.schema.json`](scoring-update-input.schema.json).

### Glob inputs
The tool accepts glob patterns for both the results and scoring inputs:

- Supported wildcards: `*`, `**`, `?`
- Results and scoring inputs are matched by **relative path without extension**.
  The relative path is computed from the glob root (the path prefix before the
  first wildcard). For example, `results/classA/a.xml` maps to
  `scoring/classA/a.json`.
- Matching is case-insensitive.
- If the results glob expands to multiple files, the scoring input must also be
  a glob.

### Regex mapping (optional)
When `--results-regex` and `--scoring-template` are provided, the tool uses the
results regex captures to resolve the scoring file path:

- The regex is applied to the results relative path from the glob root using
  forward slashes (for example, `classA/assessmentResult-1.xml`).
- The regex must match the entire relative path and is case-insensitive.
- The scoring template is resolved relative to the scoring glob root directory.
- Supported template tokens:
  - `{path}`, `{dir}`, `{base}`, `{ext}`
  - `{1}`, `{2}`, ... for numbered capture groups
  - `{name}` for named capture groups

See the regex mapping example in
[`test/test-cases/glob-regex-basic`](../test/test-cases/glob-regex-basic).

## Scope

### In scope
- `assessmentResult`, `testResult`, `itemResult`
- `outcomeVariable` with `identifier="SCORE"`
- `outcomeVariable` for rubric evaluation results (see below)
- Adding or updating item-level `SCORE` and rubric evaluation outcomes
- Updating test-level `SCORE` by summing item-level `SCORE`

### Out of scope
- Updating `completionStatus`, `duration`, `numAttempts`, or `RESPONSE`
- Modifying `correctResponse`, `mapping`, or any scoring key material inside
  the scoring source
- Reformatting or reordering existing XML
- Any custom identifiers not defined by this specification

## Standard vs tool-defined outcomes
QTI defines built-in outcome variables such as `SCORE`, `MAXSCORE`, and `PASSED`,
and a built-in `completionStatus` variable. This tool only updates `SCORE` and
does not emit or change the others. Rubric-criterion results do not have a
standard built-in identifier in Results Reporting, so the tool uses its own
identifier pattern for those outcomes.

## Matching rules
- The tool uses the assessment test file to determine item order.
- Each `itemResult/@sequenceIndex` must map to the corresponding item reference
  in the assessment test (1-based order).
- The scoring JSON `items[].identifier` must match the assessment item
  identifiers listed in the assessment test.
- If a match is not found, the update fails for that item with a clear error.

## Scoring rubric extraction
The scoring rubric is read from `qti-rubric-block` with `view="scorer"` inside
`qti-assessment-item`.

Each rubric line is a `qti-p` whose text follows this format:

```
[<points>] <criterion>
```

Parsing rules:
- `<points>` must be a number (integer or decimal).
- The rubric maximum score is the sum of all `<points>` values.
- The rubric text itself is preserved and never modified.
- Rubric criteria are ordered by appearance and are 1-based indexed.

## Scoring input format (JSON)
The scoring input provides pass/fail judgments per rubric criterion. It does not
provide numeric scores directly; the tool calculates scores using the rubric
points.

### Item structure
Each item entry contains:
- `identifier`: item identifier (must match `itemResult/@identifier`).
- `criteria` (optional array): aligned to the rubric order.
- `comment` (optional string): a per-item comment to store in the results output.

At least one of `criteria` or `comment` must be provided.

Each criterion entry contains:
- `met` (boolean): whether the criterion is satisfied.
- `criterionText` (optional string): if provided, must match the rubric
  criterion text exactly (the `<criterion>` part, without the `[<points>]`).

The rubric itself has no IDs in the current authoring format, so the default
identifier is the order index (1-based).

## Rubric evaluation output (per criterion)
For each criterion, the tool adds or updates an `outcomeVariable` under the
matching `itemResult`:

- `identifier`: `RUBRIC_<index>_MET`
  - `<index>` is the 1-based rubric order index.
- `baseType`: `boolean`
- `value`: `true` or `false`

These rubric outcome variables are tool-defined but use standard QTI
`outcomeVariable` elements.

## Item comment output
If `comment` is provided in the scoring input, the tool adds or updates an
`outcomeVariable` under the matching `itemResult`:

- `identifier`: `COMMENT`
- `baseType`: `string`
- `value`: the comment text

## Comment-only updates
If an item provides `comment` without `criteria`, the tool only updates the
comment output and does not modify rubric outcomes or scores.

## Score calculation

### Item-level SCORE
- For each criterion:
  - If `met` is `true`, add the rubric points for that criterion.
  - If `met` is `false`, add 0.
- The resulting sum is written to `itemResult/outcomeVariable identifier="SCORE"`
  with `baseType="float"`.

### Test-level SCORE
- `testResult/outcomeVariable identifier="SCORE"` is updated to the sum of all
  item-level scores written by this tool.

## Optional mode: preserve met outcomes
When the tool is run with a "preserve met" mode enabled, it must not change an
existing `RUBRIC_<index>_MET` value from `true` to `false`. In that mode:

- If the existing `RUBRIC_<index>_MET` is `true` and the input `met` is `false`,
  the output remains `true`.
- Item-level and test-level `SCORE` values are calculated using the preserved
  rubric outcomes.

## Output behavior
- On success, the tool overwrites the input results XML file with the updated
  results XML and writes nothing to stdout.
- On error, the tool writes the error JSON to stdout and leaves the input
  results XML file unchanged.
- When a results glob matches multiple files, the tool processes matches in
  deterministic order and stops on the first failure. Any files that were
  already updated before the failure remain updated.

## Validation and errors
The tool must validate:
- Root element name and namespace of the results document.
- Assessment test contains item references.
- `itemResult/@sequenceIndex` is present and maps to the assessment test order.
- Item sources contain matching `qti-assessment-item` identifiers.
- Rubric parsing succeeds and yields a maximum score.
- Each `criteria` array length equals the rubric criteria count.
- `criterionText` (when present) matches the rubric criterion text exactly.
- Results and scoring globs (when used) resolve to at least one file.
- When globbing, each results entry has exactly one matching scoring file.
- When regex mapping is enabled, the results regex is valid and matches every
  results entry.
- When regex mapping is enabled, the scoring template resolves to an existing
  scoring file for every results entry.

On error, the tool returns:
- the element path
- the identifier (if applicable)
- a concise reason for failure

## Missing rubric behavior
- If a scoring rubric is missing or unparsable, the update fails for that item.
