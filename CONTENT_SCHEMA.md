# Content and provenance

D1 tables: `source_files`, `content_items`, `citations`, `translations`, `reviews`, `quiz_questions`, `quiz_attempts`, `point_ledger`, `progress`, `bookmarks`, `partners`, `rewards`, `redemptions`, `audit_events`.

`research/SOURCE_INVENTORY.csv` holds each original file and SHA-256. `CLAIM_AUDIT.csv` identifies each paragraph/row candidate with file path and original location. `CONTENT_COVERAGE_MATRIX.csv` maps it to a world and candidate topic. Candidates can include instructions, duplicates and claims; a row is not an approved fact. The topic index in `data/source-topics.json` is derived from the archive and shown only as pending heading previews.

Planned editorial state sequence: IMPORTED → EXTRACTED → NEEDS_SOURCE → RESEARCHED → FACT_CHECKED → LANGUAGE_REVIEWED → SCHOLAR_REVIEWED → DESIGN_QA → READY_FOR_PUBLISH → PUBLISHED → CORRECTED/ARCHIVED. External approval requires evidence, scope, date and issuing body; it is not inferred from internal review.
