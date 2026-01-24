# QTI 3.0 Results Scoring Update Specification

## Purpose
Define how this tool adds or updates scoring results in QTI 3.0 Results Reporting
based on a scoring rubric contained in a separate QTI 3.0 item document.

The tool only uses standard QTI Results Reporting elements. It adds a limited set
of tool-defined outcome variables for rubric evaluation results and preserves all
other custom data as-is.

## Inputs
- **Results document**: QTI 3.0 Results Reporting XML (`assessmentResult`).
- **Scoring source**: QTI 3.0 item XML (`qti-assessment-item`) that contains the
  scoring rubric.
- **Scoring updates**: JSON that conforms to
  [`scoring-update-input.schema.json`](scoring-update-input.schema.json).

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
- By default, each `itemResult/@identifier` must match the corresponding
  `qti-assessment-item/@identifier` exactly (case-sensitive).
- When a mapping definition is provided (see below), `itemResult` identifiers
  may differ and are matched through the mapping file instead.
- If a match is not found, the update fails for that item with a clear error.

## Linking results to items
When results use `Q{n}` style identifiers and item sources use file-based
identifiers, provide a mapping definition that declares how each results
identifier maps to an item identifier.

### Mapping definition (optional input)
Provide a mapping CSV file (UTF-8, no BOM) with a single header row:

```
resultItemIdentifier,itemIdentifier
```

Each subsequent row defines one mapping entry with:

- `resultItemIdentifier` (string): the `itemResult/@identifier` value (for example `Q1`).
- `itemIdentifier` (string): the assessment item `identifier`.

Constraints:

- One-to-one mapping (no duplicates on either side).
- All `itemResult/@identifier` values in the results document must be mapped.
- All mapped `itemIdentifier` values must exist in the item source set.

Notes:

- Row order does not matter.
- Both values are treated as case-sensitive identifiers.
- When the mapping file is provided, the scoring JSON `items[].identifier` must
  refer to the item identifiers (not the result identifiers).

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
- `criteria`: an array aligned to the rubric order.
- `comment` (optional string): a per-item comment to store in the results output.

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

## Validation and errors
The tool must validate:
- Root element name and namespace of the results document.
- Presence of `itemResult/@identifier` for every targeted item.
- Scoring source contains a matching `qti-assessment-item`.
- Rubric parsing succeeds and yields a maximum score.
- Each `criteria` array length equals the rubric criteria count.
- `criterionText` (when present) matches the rubric criterion text exactly.

On error, the tool returns:
- the element path
- the identifier (if applicable)
- a concise reason for failure

## Missing rubric behavior
- If a scoring rubric is missing or unparsable, the update fails for that item.
