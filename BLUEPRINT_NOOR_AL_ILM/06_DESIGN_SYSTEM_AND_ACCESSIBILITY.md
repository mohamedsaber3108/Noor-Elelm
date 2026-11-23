# Design System, Accessibility, and Presentation

**Purpose:** preserve the existing visual identity while specifying future work. **Status:** current design retained; accessibility audit incomplete.

## Tokens

| Token | Intent | Current direction |
|---|---|---|
| `--forest` / `--green` | institutional navigation and actions | emerald/deep green |
| `--bg` / `--surface` | reading space | ivory/light surface |
| `--gold` | refined emphasis | muted gold |
| `--red` | visual card serial marker and destructive attention | restrained red |
| Amiri | wordmark/editorial Arabic display | typography-based identity |
| IBM Plex Sans Arabic | body/interface | readable Arabic UI |
| Inter | Latin metadata | numeric/Latin legibility |

## Component state matrix

| Component | Default | Loading | Empty | Error | Disabled / restricted |
|---|---|---|---|---|---|
| archive search | paginated titles | skeleton | no matching records | retry | raw text hidden |
| infographic card | draft/approved badge | poster placeholder | no candidates | source unavailable | cannot export if draft |
| quiz | question/options | next-token spinner | approved bank empty | expired token | unauthenticated CTA |
| correction form | validated fields | submit state | N/A | server/readable error | sign-in required |
| reviewer queue | assigned rows | permission check | no queue | audit fetch failure | 403 explanation |

## Motion and performance

Transitions may communicate opening a card, switching theme, or successful local interaction. Respect `prefers-reduced-motion`; do not make learning depend on animation. Keep primary content visible without decorative animation. Images/visual assets use responsive dimensions and lazy loading where non-critical.

## Accessibility acceptance

- RTL layout stays correct at 320px, 768px and desktop.
- Keyboard focus is visible; logical tab order reaches header, main, footer and forms.
- Text/controls pass contrast review in both themes.
- Labels exist for inputs, QR has textual verification alternative, icons are decorative or named.
- A manual screen-reader pass is required before public launch; current code inspection is not substitute evidence.
