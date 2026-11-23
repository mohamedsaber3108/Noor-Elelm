# Roles, Content Governance, and Safety

**Purpose:** define least-privilege control and religious editorial boundaries. **Status:** target policy; pilot authorization is reviewer allowlist only.

## Roles

| ROLE | Scope | May do | Must not do |
|---|---|---|---|
| Visitor | public | browse approved content and safe draft metadata | view raw draft prose or private user data |
| Learner | own | progress, bookmarks, eligible answers, corrections | change content/rewards |
| Guardian | linked child | consent, view child learning reports | see unrelated children or score religiosity |
| Researcher | assigned content | add sources/drafts | publish or self-approve |
| Fact/Language editor | assigned content | edit wording, record review | scholar approval/release |
| Scholar reviewer | assigned content | scholarly decision, rationale | release alone |
| Publisher | global release queue | verify all required gates and publish version | edit/scholar-review own release without separation |
| Platform admin | operations | roles, system health, incident actions | view content body unless separately authorized |

## Publication policy

A published religious/historical item needs: exact source/citation, rights status, editorial revision, relevant language review, scholar decision, design QA for visuals, and separate publisher release. A generated suggestion cannot bypass any gate. Archive material remains a research lead, not a truth claim.

## Safety controls

- No public chat for children; no algorithmic score of religiosity.
- No depictions of prophets, companions, or religious personalities as imagery.
- No AI completion of Quran/hadith as an authoritative citation.
- Restrict raw archive prose, review notes with personal data, and reports to authorized roles.
- Rate-limit corrections, quiz attempts, support intake, and authentication recovery.
- Store structured correction/support records instead of free-form unbounded audit payloads.

## Review workflow acceptance

`TEST-GOV-01`: a researcher cannot release. `TEST-GOV-02`: a scholar approval alone cannot release. `TEST-GOV-03`: content missing rights/source cannot reach READY_FOR_PUBLISH. `TEST-GOV-04`: withdrawal produces a visible version/status and audit record.
