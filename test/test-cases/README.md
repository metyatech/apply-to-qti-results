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
