# Scoring Update Test Cases

This folder contains data-only test cases for the scoring update tool.
Each case provides inputs (results XML, item source XML, scoring JSON) and the
expected output or error. These cases are intended to be consumed by an
implementation test harness later.

## Layout

- `basic/` basic success case with one item and two criteria.
- `multi-items/` success case with two items and test-level score sum.
- `criteria-length-mismatch/` error when criteria count does not match rubric.
- `criteria-missing-met/` success case that leaves criteria unchanged when met is omitted.
- `criterion-text-mismatch/` error when `criterionText` does not match rubric.
- `criterion-text-mismatch-ignored/` success when the explicit option allows
  old criterion wording while applying `met` values by array index.
- `criteria-length-mismatch-ignored/` error even when the explicit option is
  enabled, because the criteria count must match the rubric.
- `missing-rubric/` error when the item has no scorer rubric.
- `invalid-results-namespace/` error when results namespace is unexpected.
- `missing-results-namespace/` error when results namespace is missing.
- `itemresult-not-found/` error when scoring references an item missing in results.
- `scoring-source-not-found/` error when scoring references a missing item source.
- `preserve-met/` success case that preserves existing `RUBRIC_<n>_MET=true`.
- `comment-basic/` success case that writes an item comment.
- `comment-clear/` success case that clears an item comment.
- `comment-not-string/` error when comment is not a string.
- `comment-only/` success case that updates only the comment.
- `comment-missing/` error when neither criteria nor comment is provided.
- `rubric-parse-failure/` error when rubric line format is invalid.
- `criteria-not-array/` error when criteria is not an array.
- `criterion-met-not-boolean/` error when met is not a boolean.
- `criterion-text-code/` success case that preserves inline `code` text
  during `criterionText` matching.
- `criterion-text-code-mismatch/` error when inline `code` text differs
  from `criterionText`.
- `criterion-text-code-middle/` success case that preserves inline `code`
  text in the middle of a criterion.
- `criterion-text-code-middle-mismatch/` error when middle inline `code`
  text differs from `criterionText`.
- `scoring-items-empty/` error when scoring input has no items.
- `glob-basic/` success case that applies scoring to multiple results via glob input.
- `glob-missing-scoring/` error when a results glob entry has no matching scoring file.
- `glob-regex-basic/` success case that maps results to scoring via results regex and template.
- `glob-regex-mismatch/` error when a results file does not match the results regex.
- `cloze-x-to-met/` success case where cloze item criterion is corrected from false to true.
- `cloze-met-to-x-blocked/` success case where a normal cloze update changes true to false.
- `cloze-met-to-x-preserve-met/` success case where `preserveMet` keeps a cloze downgrade blocked.
- `cloze-multiple-criteria/` success case where cloze criteria are updated in both directions.
- `cloze-multiple-criteria-downgrade-blocked/` success case where `preserveMet` is not enabled and multiple cloze downgrades are allowed.
- `cloze-score-only-no-rubric-met/` success case where cloze item has SCORE but no RUBRIC_n_MET outcomes.
- `choice-criteria-ignored/` success case where choice item ignores criteria but applies comment.

## Conventions

- Results documents use the QTI 3.0 Results Reporting namespace
  `http://www.imsglobal.org/xsd/imsqti_result_v3p0`.
- Item source documents use the QTI 3.0 Item namespace
  `http://www.imsglobal.org/xsd/imsqti_v3p0`.
- Rubric lines follow the format `[<points>] <criterion>`.
- Each case includes `assessment-test.qti.xml` that references the item sources.
- Expected error files are `expected-error.json` with the minimum fields:
  `path`, `identifier` (when applicable), and `reason`.
- Glob cases include `glob.json` plus `results/` and `scoring/` directories.
- Glob success cases store expected outputs under `expected/` with matching relative paths.
- Regex glob cases add `resultsRegex` and `scoringTemplate` in `glob.json`.

## Files

- [basic](basic)
- [multi-items](multi-items)
- [criteria-length-mismatch](criteria-length-mismatch)
- [criteria-missing-met](criteria-missing-met)
- [criterion-text-mismatch](criterion-text-mismatch)
- [missing-rubric](missing-rubric)
- [invalid-results-namespace](invalid-results-namespace)
- [missing-results-namespace](missing-results-namespace)
- [itemresult-not-found](itemresult-not-found)
- [scoring-source-not-found](scoring-source-not-found)
- [preserve-met](preserve-met)
- [comment-basic](comment-basic)
- [comment-clear](comment-clear)
- [comment-not-string](comment-not-string)
- [comment-only](comment-only)
- [comment-missing](comment-missing)
- [rubric-parse-failure](rubric-parse-failure)
- [criteria-not-array](criteria-not-array)
- [criterion-met-not-boolean](criterion-met-not-boolean)
- [criterion-text-code](criterion-text-code)
- [criterion-text-code-mismatch](criterion-text-code-mismatch)
- [criterion-text-code-middle](criterion-text-code-middle)
- [criterion-text-code-middle-mismatch](criterion-text-code-middle-mismatch)
- [scoring-items-empty](scoring-items-empty)
- [glob-basic](glob-basic)
- [glob-missing-scoring](glob-missing-scoring)
- [glob-regex-basic](glob-regex-basic)
- [glob-regex-mismatch](glob-regex-mismatch)
- [cloze-x-to-met](cloze-x-to-met)
- [cloze-met-to-x-blocked](cloze-met-to-x-blocked)
- [cloze-met-to-x-preserve-met](cloze-met-to-x-preserve-met)
- [cloze-multiple-criteria](cloze-multiple-criteria)
- [cloze-multiple-criteria-downgrade-blocked](cloze-multiple-criteria-downgrade-blocked)
- [cloze-score-only-no-rubric-met](cloze-score-only-no-rubric-met)
- [choice-criteria-ignored](choice-criteria-ignored)
