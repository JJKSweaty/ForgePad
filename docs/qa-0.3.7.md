# Learning workspace visual refinement

## Problems and changes

- Daily activity used `th[scope=row]` for accessible dates, but inherited the global uppercase, letter-spaced, filled column-header styling. Scope row and column presentation separately: dates now use normal case and weight, both cells share consistent row dividers, counts align right, and nonzero counts carry a visible numeric emphasis. The details panel is bounded to 640px with a left-aligned caption and sticky column headers. All dates and zero counts remain available in the keyboard-focusable scroller.
- Question Library squeezed eight columns into each row, hid metadata at smaller sizes, and presented completion as small muted text. Group type, difficulty, estimated time, and topics beneath a readable title. Pair the current status with a large icon, a labeled badge, and a matching edge accent: green check for Completed, purple play for In progress, gold circular arrow for Needs review, and a neutral hollow circle for Not started. Bookmark and menu actions remain independent of opening a question. Mobile controls sit below the title.
- A question that previously completed but now needs review or has an unfinished draft retains its current status and shows Previously completed from the existing `has_completed` flag. Open buttons describe their status for screen readers. These cues are read-only projections of the existing model, not completion toggles.
- Roadmaps share the visual vocabulary while retaining the model's separate Solved, Mastered, and Self reviewed labels. Self review has its own icon and accent treatment; it does not become a deterministic solve.
- Dashboard next actions become separate readable rows, beside learning-path progress on wide screens and stacked on narrower screens. Progress receives clearer summary grouping, section spacing, and history filters.
- New responsive checks exposed an existing overflow from an absolutely positioned screen-reader header inside history. Give its scroller a containing block, keyboard focus and an accessible name; add a narrow-screen horizontal-scroll hint. The table keeps every detail within its own scroll area.

## Validation

- 53 frontend tests passed, including current status versus historical completion, filtering, opening, independent row controls, date boundaries and dictation behavior.
- All 18 Playwright tests passed using the existing isolated Docker runtime: code execution and submissions, autosave/checkpoints, written practice, interview replay, dictation, filters, date range behavior, responsive layout and the new visual checks.
- New screenshots cover Library at 1440/960/760/390px, Dashboard/activity and Progress at 1440/760/390px, and Roadmaps at 1440/760/390px. Light and dark themes are checked; status text meets at least 4.5:1 contrast and remains at least 12px. Representative screenshots were visually inspected and iterated. State and history fixtures used only test data; saved user progress was not edited.
- TypeScript/Vite production build, four release tests and whitespace validation passed. The existing Monaco chunk-size warning remains.
- Built, ad-hoc signed and installed ForgePad 0.3.7 in `/Applications/ForgePad.app`; signature and bundle identifier verified. Older duplicate bundles with the ForgePad identifier moved to Trash; drafts, progress, recordings and models preserved.
