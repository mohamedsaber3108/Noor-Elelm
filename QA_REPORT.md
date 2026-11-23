# QA report — private working build (2026-10-23)

## Passed

- Archive extraction: 45 source files; 3,337 stable research candidate IDs; 16 domain worlds. Reclassification confirmed 92 mosque claim candidates and 199 substantive infographic candidate headings.
- TypeScript `npx tsc --noEmit` and Vinext production build.
- Local D1 schema migrations `0000`, `0001`, `0002` applied; 16 tables generated. Unique ledger replay test from prior pilot: 10 distinct questions × three insert attempts each yielded 10 coins.
- Browser: home, a world, chapter, research detail, infographic detail and QR verification, 114-surah index, a surah, mosque index/detail, track, search, admin and dashboard route render. Light/dark desktop screenshot inspected; the wordmark was changed to one uninterrupted line.
- 199 draft infographic entries load via paginated API; world default filters candidate facts ahead of production instructions.
- 2026-10-24: first-200 queue selection checked for 200 unique IDs (199 explicitly titled infographic candidates plus one selected sira topic); TypeScript and production build passed. Local browser opened `/admin/infographics` and correctly showed reviewer-only denial without configured preview identity. Authorized owner review workflow still requires a hosted session check.

## Not yet verified / blocked by prerequisites

- Hosted sign-in and reviewer import/edit/review operations need owner-account E2E after deployment. Managed preview cannot simulate Sites identity.
- Mobile browser screenshots and touch/keyboard/screen-reader audit; automated Lighthouse, load tests and penetration assessment.
- Any unreviewed religious claim, Quran/tafsir/translation import or public educational approval.
- Real partner rewards, coupon fulfillment, payment and child-account privacy review.
- PostgreSQL/AWS deployment and backup restore drill.

The private build is a functional research and learning prototype. Passing technical checks is not scholarly certification.
