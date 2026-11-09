---
name: agencia-ele-design
description: Design system for Agencia ELE, a Spanish-as-a-foreign-language (ELE) coursebook (print, 591.9 x 804.5 pt). Use whenever the user designs, lays out or generates in the Agencia ELE style or for this course - coursebook pages, worksheets, exercises, grammar boxes/tables, title bars, folios, side tabs; presentations or slide decks for a Spanish class; lesson materials (handouts, activity cards, homework, tests, visual aids); lesson plans (plan de clase, outline, schedule); web pages, HTML pages, interactive exercises or online lessons. Trigger even if the user only says "make it look like the Agencia ELE book", "an ELE exercise page", "prepare materials for tomorrow's Spanish lesson", "format my lesson plan" or "build a lesson web page". Provides measured colour/type/spacing tokens, 13 React print components and specimen cards.
---

# Agencia ELE design system

A print design system inferred from the coursebook PDF `agencia4.pdf` (portrait, pt units). Every token is tagged observed / estimated / inferred, so you know how far to trust it.

## Workflow

1. **Read `readme.md` first.** It has the sources, the Spanish content rules, visual foundations, font substitutions and known gaps.
2. **Load the tokens** with a single stylesheet: `<link rel="stylesheet" href="styles.css">`. It imports `tokens/*.css` (colours, type, spacing, radii, borders, elevation, fonts, page geometry) and `tokens/roles.css` (semantic aliases such as `--section-accent-*`, `--role-example-text`). Use the CSS custom properties, never hard-coded hex values or px. Fonts load from Google Fonts, so the output needs network access.
3. **Pick components** from `components/<group>/<Name>.jsx`. Each has `.d.ts` (props), `.prompt.md` (usage guidance) and `.card.html` (a working example; copy its `DS.mount(...)` + React/Babel script setup via `_ds_preview.js` for a no-build preview). Read the `.prompt.md` before using a component.

   | Group | Components |
   |---|---|
   | page | `SectionTab`, `RunningFooter`, `UnitTitleBar` |
   | exercise | `ExerciseHeading`, `NumberTag`, `AudioIcon`, `AnswerLine` |
   | callouts | `Bubble`, `NotebookCard`, `StickyNote`, `WordBox`, `GrammarBox` |
   | tables | `GrammarTable` |

4. **Check against the cards.** `guidelines/*.card.html` (colours, type scale, page geometry, rules and radii, imagery) show the real values; open them when unsure which token fits.
5. `provenance.json` is the evidence for each token. Consult it when a user questions where a value comes from.

## Other formats: web pages, presentations, lesson materials, lesson plans

The components are print-page React, but the tokens carry the brand into any format. For web pages, slides, handouts, activity cards and lesson plans:

- Web pages for a lesson: load `styles.css` and build with the tokens; the components render in the browser as-is (see the `.card.html` files), but they are fixed-size `pt` print elements, so for responsive layouts reuse their look (colours, type roles, tab, title bar, boxes, tables) with fluid containers instead of scaling the print page. Interactive pieces the book has no equivalent for (buttons, inputs, quiz controls, audio players) are not part of the system: build them plainly from the tokens (ink on paper, section accent, hairline rules, small radii) and keep the book's look. Keep the page content Spanish-first and use `lang="es"`.

- Reuse the palette, type roles, accent-per-section logic and Spanish content rules; take colours and fonts from `tokens/` (hex values from `colors.css`, Google Fonts substitutes from the readme) when the target tool has no CSS.
- Slides: the page is portrait print, so do not copy its geometry; borrow the look instead (ink on white, one accent per section, tab/title-bar motifs, `GrammarBox` and `WordBox` styling for key language, `ExerciseHeading` for activity titles).
- Lesson plans: use `UnitTitleBar`/`ExerciseHeading` styling for stages, `GrammarTable` styling for timing or objectives tables, one accent per lesson section.
- Worksheets and handouts: use the print components directly at page size.

## Rules

- Spanish copy in sentence case; imperative, informal address in instructions ("Lee y relaciona…"), plural for group work; inverted `¿` `¡` marks. Capitals only for labels such as "UNIDAD 5".
- One accent colour per section (side tab, exercise headings, table header). Pick it from `--section-accent-*`.
- Example and model sentences: italic example-blue; the form under study in bold.
- Work in `pt`, on a 13pt baseline, within the page size and margins from `tokens/page.css`.
- Fonts are Google Fonts substitutes, never the PDF's own fonts; some source fonts (e.g. OceanSansStd) have no substitute, so fall back to the body face.
- Photos, illustrations and the "ELE" wordmark are not part of the system: use placeholders and write "Agencia ELE" in type.
- The system ships no web UI components (buttons, inputs, tabs, toasts); when a web page needs them, build them from the tokens as described above rather than importing another design language.
- Shadows are approximated (`--shadow-soft`) and low-confidence items (e.g. bullet semantics, U-006) are hints, not rules; say so if a user relies on them.
