# Scoring Update Test Cases

This folder contains data-only test cases for the scoring update tool.
Each case provides inputs (results XML, item source XML, scoring JSON) and the
expected output or error. These cases are intended to be consumed by an
implementation test harness later.

## Layout
- `basic/` basic success case with one item and two criteria.
- `multi-items/` success case with two items and test-level score sum.
- `criteria-length-mismatch/` error when criteria count does not match rubric.
- `criterion-text-mismatch/` error when `criterionText` does not match rubric.
- `missing-rubric/` error when the item has no scorer rubric.
- `invalid-results-namespace/` error when results namespace is unexpected.
- `missing-results-namespace/` error when results namespace is missing.
- `itemresult-not-found/` error when scoring references an item missing in results.
- `scoring-source-not-found/` error when scoring references a missing item source.
- `preserve-met/` success case that preserves existing `RUBRIC_<n>_MET=true`.
- `mapping-basic/` success case with `mapping.csv`.
- `mapping-missing-entry/` error when mapping omits a result identifier.
- `comment-basic/` success case that writes an item comment.
- `comment-not-string/` error when comment is not a string.
- `rubric-parse-failure/` error when rubric line format is invalid.
- `criteria-not-array/` error when criteria is not an array.
- `criterion-met-not-boolean/` error when met is not a boolean.
- `scoring-items-empty/` error when scoring input has no items.

## Conventions
- Results documents use the QTI 3.0 Results Reporting namespace
  `http://www.imsglobal.org/xsd/imsqti_result_v3p0`.
- Item source documents use the QTI 3.0 Item namespace
  `http://www.imsglobal.org/xsd/imsqti_v3p0`.
- Rubric lines follow the format `[<points>] <criterion>`.
- Expected error files are `expected-error.json` with the minimum fields:
  `path`, `identifier` (when applicable), and `reason`.

## Files
- [basic](basic)
- [multi-items](multi-items)
- [criteria-length-mismatch](criteria-length-mismatch)
- [criterion-text-mismatch](criterion-text-mismatch)
- [missing-rubric](missing-rubric)
- [invalid-results-namespace](invalid-results-namespace)
- [missing-results-namespace](missing-results-namespace)
- [itemresult-not-found](itemresult-not-found)
- [scoring-source-not-found](scoring-source-not-found)
- [preserve-met](preserve-met)
- [mapping-basic](mapping-basic)
- [mapping-missing-entry](mapping-missing-entry)
- [comment-basic](comment-basic)
- [comment-not-string](comment-not-string)
- [rubric-parse-failure](rubric-parse-failure)
- [criteria-not-array](criteria-not-array)
- [criterion-met-not-boolean](criterion-met-not-boolean)
- [scoring-items-empty](scoring-items-empty)
