---
name: design-from-pdf
description: Build a design system from a source PDF whose pages show the elements to be systematised, with repetition (brand book, deck, textbook, catalogue). Analyses the PDF (composites, page structure, coverage, usage), writes a pattern analysis and proposed inventory, stops for user approval, then emits the same design-system directory layout as /design-generating (tokens, cards, components, readme) so /mockups-creating reads it unchanged. Infers from visual evidence and tags every item observed or inferred.
disable-model-invocation: false
---

# Design system from a PDF

You turn a PDF into a design system on disk: measured tokens, the repeated elements of the document as components and specimen cards, how those elements are laid out and combined, a readme, and a `SKILL.md` that makes the directory a portable Agent Skill. It is the front-end for sources that are **pictures of a design** rather than code. For a codebase or Figma file use `/design-generating` instead; this skill does not replace or modify it.

Unlike `/design-generating` (extract and copy, never invent), you **infer** from what the pages show. The tools measure; you judge. Every item you write is tagged `observed` (measured, with page refs), `estimated` (derived or sampled), or `inferred` (your judgement, with a confidence and the reasoning). Nothing is unlabelled. **Tools propose, vision completes**: the scripts cluster and measure, you look at every page and finish what they missed.

## Requirements and where things live

- bash, **Python >= 3.9**, and network on the **first** run only (pinned wheels from PyPI; afterwards it works offline). No poppler, no Cairo, no global installs.
- The Python environment lives in a user data directory, `DFP_HOME` (default `%LOCALAPPDATA%/design-from-pdf`, else `${XDG_DATA_HOME:-~/.local/share}/design-from-pdf`), keyed by the pinned requirements. The skill directory itself is never written to.
- Optional, for the visual check only: a system Edge or Chrome (or `DFP_BROWSER`) and network (preview cards load React from a CDN).

**Run every command through the wrapper in this skill's base directory** (the directory that contains this `SKILL.md`): `bash "<base directory>/dfp.sh" <command> ...`. Resolve `<base directory>` from where this skill was loaded; never hardcode an install path. The first call installs the environment (about 2 minutes); a failure prints `blocked:` and exits 3. Do not work around it with a system Python. Paths you pass (a relative `<ds>` or `--pdf`) are resolved once, so any current directory works.

| Command | What it does | Exit |
|---|---|---|
| `dfp.sh analyze <pdf> --ds <ds> [--force] [--threshold PCT] [--dpi N]` | every page, no limit and no sampling: probe, extract, cluster (composites), structure, coverage, usage, inventory, renders, crops, overlays -> `<ds>/_analysis/` | 0 ok, 3 blocked, 2 refused (edited or approved `analysis.md`) |
| `dfp.sh render <ds> [--pages 7,8]` | re-render the overlay PNGs (only the named pages when given) | 0, 3 |
| `dfp.sh gate <ds>` | `analysis.md` -> `approved.json`, only when approved and every blocker is resolved | 0 ok, 4 not satisfied |
| `dfp.sh scaffold <ds>` | tokens, `styles.css`, provenance, manifest skeleton, `_ds_preview.js`, `_analysis/substitutions.json` | 0, 3 blocked, 4 no approval |
| `dfp.sh validate <ds>` | structural checks of the finished system (JSON) | 0 clean, 5 violations |
| `dfp.sh verify <ds> --pdf <pdf>` | token fidelity + side-by-side PDF / design-system sheets (single and multi-instance) | 0 ok, 5 token mismatch, 3 blocked |
| `dfp.sh crop <pdf> --page N --bbox x0,y0,x1,y1 --out <png>` | copy a brand mark out of the PDF (<= 512 px) | 0, 2, 3 |
| `dfp.sh probe <pdf>` | facts about the PDF only (JSON) | 0, 3 |

`<ds>` is the design-system directory: the user's, or `design-system/` in the current directory. Exit 3 for a PDF means encrypted or unreadable: say so and stop, never guess. `--threshold` is the **Unclaimed threshold** in percent of the page (default 0.1).

## Modes: standalone or inside a Talaka project

**Standalone** (default): do the work, then print a summary of **≤ 8 lines** to the user: verdict, paths, numbers. No log file.

**Inside a Talaka project**: if `.tlk/` exists, or a feature folder holds a `handoff-log.md`, the coordinator contract applies on top. On entry run `bash .tlk/autoresearch/tools/record-metrics.sh --mark-start --agent design-from-pdf 2>/dev/null || true`. Append progress entries to the feature's `handoff-log.md` at each checkpoint (analysis written, vision pass done, tokens scaffolded, components done, verify done) and exactly one return entry before returning, with `Result:`, `Artifacts:`, `Recommend:`, `Why:`, `Blockers:`. Before the return entry run `bash .tlk/autoresearch/tools/record-metrics.sh --feature <feature-path> --agent design-from-pdf` (skip silently if absent; never pass an estimated `--tokens`). The return message is **≤ 8 lines**. **Never invoke an agent or another skill**: you name a recommendation, the coordinator decides. `Recommend:` is `STOP - user approves analysis.md` after phase 1, and `/mockups-creating` after phase 2.

## Phase 1 - Analyze, vision pass, then STOP

1. `bash "<base directory>/dfp.sh" analyze <pdf> --ds <ds>`. It prints one line per stage (`[i/9] ...` with a `page k/T` counter), then a summary of at most 8 lines (counts, coverage, vision pass 0/T, what needs you, elapsed time). It writes `<ds>/_analysis/`: `_analysis/analysis.md` (the checkpoint document), `_analysis/inventory.json`, `_analysis/probe.json`, `_analysis/extract.json`, `_analysis/clusters.json`, `_analysis/medium.json`, `_analysis/structure.json`, `_analysis/coverage.json`, `_analysis/usage.json`, and under `renders/` the pages and one overlay per page, under `crops/` the crops. It builds nothing else. There is no page limit and no sampling: a long document takes longer, it is never cut. A raster PDF is a state, not an error: zero clusters, nothing `observed`, coverage n/a, the vision pass carries everything.
2. Read `analysis.md` from the top. **Needs you** counts what blocks approval; **Coverage** says what share of the non-photo area the clusters and the structure account for and the rest is listed under **Unclaimed**. Composite elements (a bubble with its shadow, badge and text; an icon made of parts; a side tab on the left or right edge) are **one** `CMP` row; their pieces are listed under `absorbed:` and are not components of their own. Size, colour and edge side are variants, not separate rows.
3. **Vision pass (mandatory).** View every overlay `renders/overlay-NNN.png`, one per page, with your own eyes (open the images; numbers alone are not enough). Line style carries the meaning: solid = a `CMP` row, dash-dot = a `STR` row, dashed = an `UNC` region, each with its id printed. For each page look for what the tools missed (a word box, an icon, a table) or got wrong, and complete it:
   - add each missed element as a row: `- [x] CMP-901 | `word-box` | word-box | observed | p.8, n=1, found: vision, bbox 62,640,300,712` (only a `CMP` row with `found: vision` may be new; the id must not collide);
   - write the result in the page's **Vision pass** table row: `none missed`, or `added: CMP-901`. A page left `pending` or `failed (render)` blocks the gate (`VISION_PENDING`); after a render error run `dfp.sh render <ds> --pages 7,8`.
4. Improve `analysis.md` in place; keep the row grammar `- [x] ID | value | label | status | evidence` (a literal pipe is `\|`; never start a free-text line with `- [`):
   - **Name every `CMP` row** in the label and value cells from its crop (speech bubble, side tab, answer bullet, running footer). Labels become names, so keep them short and unique. An unnamed kept row is `UNIDENTIFIED_CMP`. Do not change the value or evidence cells of measured rows.
   - **Resolve every `UNC` row** (an unclaimed region at or above the **Unclaimed threshold**): replace `(unnamed)` with a name, write `  - merge: CMP-007` under it to fold it into a component, or untick it. Smaller regions are auto-dismissed and listed in a table. Resolve the rest or the gate says `UNRESOLVED_UNC`.
   - **Usage lines.** From each row's `measured:` line (overlap, z-order, rotation, spacing, anchor, per page, co-occurrence) write one rule under the row: `  - usage [inferred, high]: bubbles may overlap by up to ~25 %, the later one on top.` The tag is `inferred` with a confidence; a measurement you only restate stays `observed`. A user edit turns the tag into `usage [inferred, high] (edited)`; never overwrite an edited line. Where nothing was measured say so: `No overlap/rotation observed; defaults apply (overlap: none, rotation: 0°, anchor: free).`
   - **Structure and templates.** `STR-` rows are the page frame, columns, body rhythm, text roles (heading-1..N, body, caption), dividers, section blocks, photo frames and table grids; `TPL-` headings group pages that share a layout, with zones and the components seen in each. Name a template under its heading, correct a value in the row.
   - **Target media.** The `Medium:` header is the source; `Target media:` lists the media the system must also serve (default: web-ui, presentation, publication-print; marketing is off). Remove a target to drop its adaptations; observed source rows are always kept. Tool-derived `ADP-` rows (button, input, hover states, slide layout, title slide, page geometry) are `inferred` and cite their sources. Add semantic adaptations yourself as `ADP-nnn` rows (side tab -> tabs, callout -> alert): status `inferred`, evidence `adapted-from: <ids>; confidence: <low|medium|high>; <why>`. A row without `adapted-from` is `BAD_ADAPTATION`; a component the enabled targets cannot have is `INVALID_FOR_TARGETS`.
   - Add what the pages imply but do not state as **inferred** rows under *User additions*: `- [x] U-001 | value | label | inferred | confidence medium; reasoning: ...` (a type scale, semantic colour roles, a spacing rhythm). Also list each in *Inferred items*. Never mark an exact vector value `inferred`.
   - Check the **medium**: detected from evidence, shown in `Medium:` and *Not applicable* (grouped by reason; web-only components are N/A only when no target is web). If the page aspect is about 2:1 the contents may be two-page spreads: ask the user whether to treat them as one `spread` layout.
   - Note the document language(s); content fundamentals are derived in the document's own language.
   - Fonts are never extracted or shipped: each family maps to the nearest Google Fonts substitute (flagged later). Symbol and ornament fonts become brand marks to crop.
5. **STOP.** Do not run `gate` or `scaffold` yourself, and do not set `Approved:` on the user's behalf. Tell the user to review `<ds>/_analysis/analysis.md`: tick or untick rows, edit values and usage lines, resolve the `UNC` rows, add `U-` rows, change `Medium:` or `Target media:`, set `Inferred: drop` to discard all inferred items, and finally write `Approved: <date> <name>`. Re-running `analyze` refuses to overwrite an edited or approved `analysis.md` (exit 2); `--force` first saves it as `analysis.prev.md` next to it, then overwrites and discards the approval.

## Phase 2 - Build (only after the user approved)

1. `bash "<base directory>/dfp.sh" gate <ds>`. Exit 4 prints every problem at once, one per line, with the ids (at most five shown): `NOT_APPROVED`, `NO_ANALYSIS`, `MALFORMED_ROW`, `NO_MEDIUM`, `BAD_MEDIUM`, `BAD_TARGET`, `UNKNOWN_ID`, `BAD_ADAPTATION`, `UNRESOLVED_UNC`, `VISION_PENDING`, `UNIDENTIFIED_CMP`, `INVALID_FOR_TARGETS`. Report them and STOP; never edit around the gate. `_analysis/approved.json` then records the targets, every kept row and the fragments (a fragment follows its parent's tick unless you kept it with `split: CL-nnn`).
2. `bash "<base directory>/dfp.sh" scaffold <ds>`: tokens for every kept item (user edits win, dropped items are absent), the structure as `tokens/*.css` (`--page-margin-top|right|bottom|left`, `--col-gap`, `--leading-body`, in pt, plus `-px` and `-rem` variants when web-ui is an enabled target: 1pt = 1.333px, 1rem = 16px), `styles.css` (`@import` lines only), `provenance.json`, `_ds_manifest.json` skeleton, `_ds_preview.js`, `_analysis/substitutions.json`. Read its warnings: skipped rows need a fix in `analysis.md` and a re-gate.
3. **Components and layouts**, one family per confirmed medium and enabled target, named by you from the approved `CMP` rows and the page crops (for print, groups such as `exercise/`, `callouts/`, `page/`, `tables/`). The approved inventory is the list: do not add Toast, Tabs, Switch, Avatar or anything the PDF and the enabled targets do not call for. Print and presentation components are **React + CSS exactly like web ones**: `components/<group>/<Name>.jsx` (one named PascalCase export, React only, styled through the CSS custom properties), `<Name>.d.ts` (props contract), `<Name>.prompt.md`, optional `<Name>.stories.tsx`, and one `*.card.html` per group rendering the real components through `_ds_preview.js` (see `/design-generating` for the loader pattern: React 18, ReactDOM and Babel from a CDN, `DS.mount`). **Every `<Name>.prompt.md`** has line 1 what-and-when, a small JSX example, variants, and a non-empty **`## Usage & composition`** section built from the approved usage line and the `measured:` numbers: when to use it and what not to combine it with, overlap, rotation, anchor, max per page, evidence with page refs and the `observed` / `inferred` tag. Add each component to `_ds_manifest.json` with **`source_clusters`** (the `CL-` ids from the approved row's `cluster` and `absorbed` fields), e.g. `{"name":"Bubble","sourcePath":"components/callouts/Bubble.jsx","source_clusters":["CL-021"]}`. If the user downgraded a medium to CSS-only specimens, write the cards and no `.jsx`.
4. **Specimen cards** in `guidelines/*.card.html`, one concept each (colors by role, type scale, spacing/page geometry, rules, imagery treatment...), line 1 `<!-- @dsCard group="Colors" viewport="700x150" name="..." subtitle="..." -->`, linking `../styles.css`. Plus **`guidelines/composition.card.html`**: the multi-instance rules (overlap, z-order, rotation, anchoring, page templates) shown with real components, same first-line contract; `validate` fails a system with components and no such card (`COMPOSITION_CARD_MISSING`). Alias tokens you add go in an extra `tokens/*.css` imported from `styles.css` with a `provenance.json` entry `inferred`.
5. **Assets**: brand marks only (logo, icons, ornaments, bullet glyphs). Copy them out of the PDF with `dfp.sh crop` (<= 512 px) into `assets/`; **never redraw** a logo, never hand-draw an SVG. Content photos and illustrations are never shipped: write an *imagery* guideline instead and keep example crops only in `_analysis/`. No logo in the PDF: say so in the readme and render the name in type.
6. **`readme.md`** in English, with these sections: **Sources**, **Index**, **Components**, **Intentional additions** (every inferred item, by id), **Content fundamentals**, **Visual foundations**, **Iconography**, **Layout & composition rules** (per component the usage rules, and the structure: page frame, columns, rhythm, templates, each with its id, tag and pages), **Substitutions & gaps**. Provenance: every token and component names its source (page refs, observed or inferred) in the readme or `provenance.json`.
7. **Substitutions & gaps** is where honesty lives: each font family -> its Google Fonts substitute, kind and confidence (copy from `_analysis/substitutions.json`; the original fonts are not redistributed and are never extracted), what could not be measured (`shadows`, `gradients`, anything under `unknown`), raster-derived values (`estimated`), unresolved drift and any skipped visual check.
8. **`<ds>/SKILL.md`**: frontmatter `name: <brand>-design`, `description: Use this skill to generate well-branded interfaces and assets for <Brand> ...`, `user-invocable: true`; body tells the reader to read `readme.md` and explore the files.
9. `bash "<base directory>/dfp.sh" validate <ds>`; fix every violation and repeat until exit 0.

### Verify the output against the PDF

10. `bash "<base directory>/dfp.sh" verify <ds> --pdf <pdf>`. It checks that every kept token has the approved value (exit 5 on a mismatch: fix `tokens/`, never the approval) and, for every component that declares `source_clusters`, renders its card and writes a **side-by-side** sheet `_analysis/verify/<Component>.png` (PDF crop left, design system right) plus a `colour_drift` number. A component whose source overlaps or rotates also gets a **multi-instance** pair (several instances together, the composition card on the right). Components without `source_clusters` are listed as `unpaired`: add them or say why not. The report carries per-card timing.
11. **View every pair**: open each sheet and judge structure, colour, proportion, spacing and, for multi-instance pairs, the overlap and rotation. Fonts are substitutes, so glyph shapes are not the test. Then write `<ds>/_analysis/verify.md`:
    ```
    # Verification
    Visual: performed
    - Callout | match | radius, fill and note shape agree with the crop
    - Folio | fixed | rule weight corrected, re-verified
    ```
    Verdicts are `match`, `fixed` or `drift`; give each multi-instance pair its own verdict line. Fix each drift in the component or tokens and re-run `verify` - **at most 2 fix rounds**. Whatever is still `drift` goes under *Substitutions & gaps* and the row stays honest.
12. If the check cannot run (no browser, no network, a render error) `verify` prints `visual: skipped` with a reason. Write `Visual: skipped (<reason>)` in `verify.md` **and say so in Substitutions & gaps**; `validate` fails an undisclosed skip. Never write `match` for a pair you did not look at.
13. Re-run `validate` until it exits 0, then return: the directory path, counts (tokens, cards, components, pairs verified), the substitutions and gaps, and the question the user should answer. Recommend `/mockups-creating`, which reads the directory unchanged.

## Rules you do not bend

- **Measured beats guessed.** Exact vector values are never labelled `inferred`; what a scan cannot measure is recorded as unknown, not invented. Raster-derived values stay `estimated`; peak memory and coverage are `null` when they cannot be measured, never estimated.
- **Never redistribute** source material: no font binaries (substitute from Google Fonts, flagged), no content photos or illustrations; brand marks only, cropped from the PDF and never redrawn.
- **The user approves the analysis** before anything is built. You never write `Approved:` yourself, and you never view-skip the vision pass.
- **No application code**; the design-system directory only. Do not edit `/design-generating`.
- Scanned (raster) PDFs: values are sampled and `estimated`; use your own vision on the page renders and overlays. There is no OCR dependency.
- **Never invoke an agent or call another skill.** Return to whoever started you.

## Troubleshooting

- `blocked: no working Python >= 3.9`: install Python or set `DFP_BASE_PYTHON`. `blocked: pip install failed`: network; the next run retries. Set `DFP_HOME` to a writable directory if the default is not.
- `analyze` exit 2: `analysis.md` was edited or approved; read it, or pass `--force` to start over (your file is kept as `analysis.prev.md`).
- Large PDFs: nothing is sampled; time grows with page count and image size, memory stays flat. The stage lines show where it is.
- `verify` screenshots each card with a headless browser and can take about a minute per card while React, Babel and Google Fonts load; a blank first frame is retried once. If it still fails it degrades to `visual: skipped` with the reason.
- No preview in cards: they need network for React and Babel and are served over http, not `file://`.
