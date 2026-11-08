# /design-from-pdf — user guide

Build a design system from a PDF whose pages show the elements to be systematised, with repetition: a brand book, a deck, a textbook, a catalogue. The skill measures the PDF, proposes an inventory, **stops for your approval**, then writes the same `<ds>/` directory layout as `/design-generating`, so `/mockups-creating` reads it unchanged.

Source of truth for commands and rules: `.claude/skills/design-from-pdf/SKILL.md`. This guide explains how to drive it and read what it writes.

## When to use which skill

| Your source | Use |
|---|---|
| Code, Figma, brand assets (things that can be copied) | `/design-generating` — extracts and copies, never invents |
| A PDF (pictures of a design) | `/design-from-pdf` — measures and **infers**, tags every item |
| Both | Run `/design-generating` for the code, `/design-from-pdf` for the PDF into a separate `<ds>`; they do not merge |

The two skills share an output contract, not code. `/design-from-pdf` never edits `/design-generating`.

## Requirements

- bash and Python >= 3.9. Network on the **first** run only (pinned wheels from PyPI), then offline.
- The Python environment lives in `DFP_HOME` (default `%LOCALAPPDATA%/design-from-pdf`, else `${XDG_DATA_HOME:-~/.local/share}/design-from-pdf`). The skill directory is never written to.
- First run installs the environment (about 2 minutes). A failure prints `blocked:` and exits 3; do not work around it with a system Python.
- Optional, for the visual check: Edge or Chrome (or `DFP_BROWSER`) and network (preview cards load React from a CDN).

## The two-phase flow

```
pdf -> analyze -> vision pass (every page) -> analysis.md complete
                                                  |
        you edit analysis.md, resolve "Needs you", write "Approved: <date> <name>"
                                                  v
   gate -> scaffold -> components, cards, readme -> validate -> verify -> /mockups-creating
```

Nothing is built until `analysis.md` carries an `Approved:` line. Claude never writes it for you.

### Phase 1 — analyze

Ask Claude to run `/design-from-pdf` on your PDF (optionally name the target directory; default `design-system/`). Claude runs:

```bash
bash "<skill dir>/dfp.sh" analyze agencia4.pdf --ds design-system
```

| Option | Effect |
|---|---|
| `--force` | Overwrite an `analysis.md` you have edited or approved. Your file is first saved as `analysis.prev.md` next to it, and the approval is discarded. |
| `--threshold PCT` | Unclaimed threshold, percent of page area (default 0.1). |
| `--dpi N` | Page render resolution. |

There is no page limit and no sampling: a 300-page PDF is analysed in full, page by page with flat memory. Progress prints per stage (`[i/9]`, `page k/T`) and a summary of at most 8 lines ends the run. Everything lands in `<ds>/_analysis/` (`analysis.md`, JSON facts, `renders/`, `crops/`). Nothing else is built.

Then Claude does the **vision pass**: it opens every `renders/overlay-NNN.png`, completes what the tools missed, names the components, and writes usage rules. You review the result. You do not review a file that still says `pending`.

If `analyze` exits 2 ("REFUSED"), `analysis.md` has your edits or an approval. Read it, or pass `--force` to start over.

### Phase 2 — build (after you approve)

```bash
dfp.sh gate <ds>        # analysis.md -> approved.json
dfp.sh scaffold <ds>    # tokens, styles.css, provenance, manifest skeleton, substitutions.json
# Claude writes components, cards, readme, <ds>/SKILL.md
dfp.sh validate <ds>
dfp.sh verify <ds> --pdf <pdf>
```

Exit codes: `0` ok, `2` refused, `3` blocked (encrypted or unreadable PDF, failed install), `4` gate or approval not satisfied, `5` validation or token mismatch.

Other commands: `render <ds> [--pages 7,8]` re-renders overlays; `crop <pdf> --page N --bbox x0,y0,x1,y1 --out <png>` copies a brand mark (<= 512 px); `probe <pdf>` prints PDF facts as JSON.

## Reading `analysis.md`

The file is ordered by decision, not by data. Read in this order:

1. **Header lines** — all editable:
   ```
   Medium: publication-print                     # what the PDF IS
   Target media: web-ui, presentation, publication-print   # where the DS will be USED
   Layout: single pages                          # or "spreads" (aspect ratio >= 1.8)
   Cluster tolerance: size +-15 %, structure >= 0.8   # shown; change = re-run analyze
   Unclaimed threshold: 0.1 %
   Approved: no
   Inferred: keep                                # "drop" discards every inferred item
   ```
2. **Needs you** — counts of what blocks approval (unclaimed regions, unidentified components, low-confidence inferences). Get the blocking ones to 0.
3. **Coverage**, **Vision pass**, **Probe**, **Medium and targets**, **Not applicable**, **Structure**, **Page templates**, **Inventory**, **Components**, **Adaptations**, **Unclaimed**, **Usage**, **User additions**, **Inferred items**, **Checkpoint**. Every section shows its row count; an empty one prints `none`. There is no row cap, so use the **Contents** index and skip sections with no action.

### Row grammar

First line, always parseable:

```
- [x] CMP-007 | `speech-bubble` | speech-bubble | observed | p.2-3, n=9 (90pt×5, 130pt×4)
  - members: shape + shadow + badge + text; absorbed: CL-031, CL-032, CL-044
  - variants: size 90|130pt · colour by unit
  - measured: overlap 0–24 % (median 8 %), later on top · rotation 0° · anchor free · 1–3 per page
  - usage [inferred, high]: bubbles may overlap by up to ~25 %, later one on top.
```

- `[x]` keeps the row, `[ ]` drops it. Edit the value or label cells to override. A literal pipe is `\|`. Never start a free-text line with `- [`.
- Id prefixes: `COL TYP SPC RAD BRD SHD ICN IMG CMP STR TPL UNC ADP MOT U`.
- **Status tags — every item carries one:**

  | Tag | Meaning |
  |---|---|
  | `observed` | Measured from the vector data, with page refs. Exact values are never `inferred`. |
  | `estimated` | Derived or sampled (raster PDFs, sampled colours). |
  | `inferred` | Claude's judgement, with a confidence and reasoning. |
  | `unassigned` | An unclaimed region nobody has named yet (`UNC` rows only). |

- `members`, `absorbed`, `variants`, `measured`, `crop` are tool output: do not edit; they are overwritten on re-run. The `usage` line is the editable prose. An edited line becomes `usage [inferred, high] (edited)` and is never overwritten.
- Missing measurement is the word `unknown`, never blank.

### Composites and variants

A speech bubble drawn with its shadow, badge and text is **one** `CMP` row, not four. An icon made of five parts is one row. A side tab on the left or right edge is one row with `side=left|right`. Size, colour and edge side are variants inside the row. The pieces appear under `absorbed:` and are not components of their own.

Untick the parent and its absorbed fragments drop with it. To keep one fragment as a standalone component, write `  - split: CL-044` under the parent.

## Source medium vs target media

- `Medium:` is evidence about the PDF (detected, editable). A textbook is `publication-print`.
- `Target media:` is where you will use the design system. Valid names: `web-ui`, `presentation`, `publication-print`, `marketing`. Default is the first three, all enabled; `marketing` is never default.
- Observed rows from the source are **always kept**, even if the source medium is not a target. Dropping a target removes only its adaptations and tokens.
- An **adaptation** (`ADP-` row) is a component or token the PDF does not show but a target needs. It is always `inferred` and must cite `adapted-from: <source ids>; confidence: <low|medium|high>; <why>`.

  | From the print source | Inferred adaptation |
  |---|---|
  | Side tab | Tabs / section nav |
  | Callout, note | Alert, toast |
  | Running footer | Pagination |
  | Table | Data table |
  | Palette and type | Button, input, hover/focus states, slide layouts, title slide |

- Web-only components (toast, tabs, switch, hover, motion) are "not applicable" only when **no** enabled target is web. With `web-ui` dropped you get the round-1 behaviour: print components only.
- Units: tokens are emitted in pt, plus px and rem when `web-ui` is a target (1pt = 1.333px, 1rem = 16px).
- Dropping a target: delete its name from `Target media:`. Dropping one adaptation: untick it. Dropping all inferred items: `Inferred: drop`.
- If the page aspect is about 2:1, the pages may be two-page spreads; Claude asks you whether to treat them as `Layout: spreads`.

## Coverage and unassigned regions

**Coverage** is the share of non-photo area (drawing plus text bounding boxes, image blocks excluded, per page) claimed by a cluster, a structural element, or an explicit dismissal. It is the stop condition: not a row count. Pages whose drawing coverage is under 85 % are marked `LOW`.

Everything not claimed is listed as an `UNC` region with a crop:

- **At or above the threshold** (default 0.1 % of the page): an interactive row, ticked, `unassigned`. Resolve it one of three ways:
  ```
  - [x] UNC-014 | `p.8 bbox 120,300,180,340 · 0.3 %` | word-box | unassigned | crop: crops/unc-014.png
  - [x] UNC-015 | `p.8 …` | (unnamed) | unassigned | …
    - merge: CMP-007
  - [ ] UNC-016 | …                       <- unticked = dismissed
  ```
  Name it (it becomes a `CMP`, n=1), `merge:` it into a cluster, or untick it. The gate refuses while any ticked `unassigned` row remains (`UNRESOLVED_UNC`).
- **Below the threshold**: a compact auto-dismissed table. No tick, still listed. Raise `--threshold` and re-run `analyze` to change the tiers.

### The vision pass and overlays

Every page has `renders/overlay-NNN.png`. Line style carries meaning: **solid** = a `CMP` row, **dash-dot** = a `STR` row, **dashed** = an `UNC` region, with the id printed on each. Claude views each overlay and records per page either `none missed` or `added: CMP-901` in the **Vision pass** table. A missed element becomes a row such as:

```
- [x] CMP-901 | `word-box` | word-box | observed | p.8, n=1, found: vision, bbox 62,640,300,712
```

A page left `pending` or `failed (render)` blocks the gate (`VISION_PENDING`). After a render error run `dfp.sh render <ds> --pages 7,8`.

## Structure and page templates

Structure is not a component. `STR-` rows describe the page: frame (margins from text and rule extents), columns and gutter, body rhythm (modal line gap per text style), text roles (heading-1..N, body, caption, list item, footnote, label), dividers, section blocks, photo frames, table grids. You correct a value in the row.

`TPL-` headings group pages that share a layout (exercise page, contents page, grammar-table page, full-photo page). Each lists its pages, zones, and which components appear in which zone. Name a template under its heading.

Structure becomes tokens (`--page-margin-top|right|bottom|left`, `--col-gap`, `--leading-body`), `page/` layout components (`PageFrame`, `Columns`, `Section`) and a guideline card.

## Usage and composition

Two kinds of fact, kept apart:

| Kind | Who | Tag | Example |
|---|---|---|---|
| Measured relations | tool | `observed` | overlap 0–24 %, z-order, rotation range, nearest-neighbour distance, anchor, per-page count, co-occurrence |
| Rules of use | Claude, editable by you | `inferred` | "bubbles may overlap by up to ~25 %, later one on top" |

Where the output carries them:

- a **`## Usage & composition`** section in every `<Name>.prompt.md` (never empty; with no evidence it says `No overlap/rotation observed; defaults apply`);
- `guidelines/composition.card.html`, showing multi-instance arrangements with the real components (`validate` fails a system with components and no such card: `COMPOSITION_CARD_MISSING`);
- the readme section **Layout & composition rules**;
- in `verify`, a **multi-instance** PDF-vs-design-system pair for each component with overlap or rotation evidence.

## Gate codes

`dfp.sh gate <ds>` prints every problem at once, with ids (at most five shown), and exits 4. Fix them in `analysis.md`; never around the gate.

| Code | Means | Fix |
|---|---|---|
| `NOT_APPROVED` / `NO_ANALYSIS` | No `Approved:` line, or no file | Write `Approved: <date> <name>` |
| `MALFORMED_ROW` / `UNKNOWN_ID` | A row does not parse, or its id is unknown | Fix the row at the named line |
| `NO_MEDIUM` / `BAD_MEDIUM` | `Medium:` missing or invalid | Use a valid medium name |
| `BAD_TARGET` | Unknown name in `Target media:` | Use `web-ui`, `presentation`, `publication-print`, `marketing` |
| `UNRESOLVED_UNC` | Ticked `unassigned` rows remain | Name, `merge:`, or untick |
| `VISION_PENDING` | A page's vision pass is `pending` or `failed` | Finish the pass; `render --pages` after a render error |
| `UNIDENTIFIED_CMP` | A kept `CMP` has no name | Name it from its crop |
| `BAD_ADAPTATION` | An `ADP-` row without `adapted-from` | Add `adapted-from: <ids>` or untick |
| `INVALID_FOR_TARGETS` | A component needs a target that is not enabled | Enable the target or untick the row |

## What you get

```
<ds>/
  styles.css            @import lines only
  tokens/*.css          colours, type, spacing, page geometry, radii, ...
  components/<group>/   <Name>.jsx · .d.ts · .prompt.md · .card.html
  guidelines/*.card.html   specimen cards + composition.card.html
  assets/               brand marks cropped from the PDF (never redrawn)
  readme.md  SKILL.md  _ds_manifest.json  provenance.json
  _analysis/            analysis.md, JSON facts, renders, crops, verify/
```

`_ds_manifest.json` records `source_clusters` (the `CL-` ids) per component. `verify` uses them to write side-by-side sheets `_analysis/verify/<Component>.png`; Claude views each pair and writes `_analysis/verify.md` (`match`, `fixed` or `drift`, at most 2 fix rounds). Remaining drift is disclosed in the readme under **Substitutions & gaps**. A skipped visual check (no browser, no network) is disclosed there too; `validate` fails an undisclosed skip.

The directory is also a portable Agent Skill (`<ds>/SKILL.md`).

## Supported PDFs and precision

| PDF type | What you get |
|---|---|
| Vector + text layer (InDesign, Illustrator, Figma export) | Exact `observed` values: colours, fonts, sizes, stroke widths, radii, margins, overlap |
| Mixed | Exact where vector, `estimated` where raster |
| Raster / scanned | A state, not an error: zero clusters, nothing `observed`, coverage n/a. Colours and sizes are sampled and `estimated`; the vision pass carries everything. No OCR. |
| Encrypted or unreadable | Exit 3: the skill says so and stops |

## Fonts, images, and what is never shipped

- Fonts are never extracted or redistributed. Each family maps to the nearest Google Fonts substitute (kind and confidence in `_analysis/substitutions.json`, repeated in the readme). Symbol and ornament fonts become brand marks to crop.
- Brand marks (logo, icons, ornaments, bullet glyphs) are copied out of the PDF with `crop` (<= 512 px). A logo is never redrawn. No logo in the PDF: the readme says so and the name is set in type.
- Content photos and illustrations are never shipped; you get an *imagery* guideline, and example crops stay in `_analysis/` (git-ignored for renders and verify output).

## Worked example: a Spanish textbook (`agencia4.pdf`)

24 pages, 592×805 pt, InDesign vector with text layer, about 25 commercial font families.

- Medium `publication-print`. Default targets add web-ui and presentation, so the checkpoint shows inferred adaptations (side tab -> tabs, callout -> alert, footer -> pagination, table -> data table, button/input) each citing its print source.
- Observed components include exercise heading, answer bullets, post-it and note callouts, speech bubbles (one cluster, several sizes, overlap and z-order measured), audio icon (about 10 pink disks on pp. 9, 10, 13, 19, 24, one cluster with absorbed parts), side tab (left and right, one cluster), green table, numbered photo tag, section banner.
- Structure: margins, a 2-column body on grammar pages, at least 4 page templates, a heading hierarchy of 3+ levels. Coverage target is 90 % of non-photo area; the rest is listed as `UNC`.
- Content fundamentals are derived in Spanish (casing, numbering, instruction voice); the readme stays English.
- Drop `web-ui` and `presentation` from `Target media:` and you get print components only.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `blocked: no working Python >= 3.9` | Install Python, or set `DFP_BASE_PYTHON`. |
| `blocked: pip install failed` | Network. The next run retries. Set `DFP_HOME` to a writable directory if the default is not. |
| `analyze` exit 2 | `analysis.md` is edited or approved. Read it, or `--force` (kept as `analysis.prev.md`). |
| `analyze` exit 3 on a PDF | Encrypted or unreadable. Nothing is guessed. |
| Long run on a big PDF | Nothing is sampled; time grows with pages and image size, memory stays flat. Watch the stage lines. |
| Gate exit 4 | Read the codes above; fix in `analysis.md`; re-run. |
| `scaffold` warns about skipped rows | Fix the rows in `analysis.md` and re-run `gate`. |
| `verify` takes about a minute per card | A headless browser loads React, Babel and Google Fonts. A blank first frame is retried once. On failure it degrades to `visual: skipped` with a reason. |
| No preview in cards | They need network (React, Babel) and are served over http, not `file://`. |
| Overlay missing for a page | `dfp.sh render <ds> --pages N`. |
| Relative `<ds>` or `--pdf` | Resolved once to absolute; any working directory works. |

## Inside a Talaka project

If `.tlk/` exists, the skill also logs progress to the feature's `handoff-log.md` and returns once, in 8 lines or fewer. It recommends `STOP - user approves analysis.md` after Phase 1 and `/mockups-creating` after Phase 2. It never invokes another agent or skill. Without `.tlk/` it runs standalone and prints an 8-line summary.

## Packaging

The skill directory is the shipped package: `SKILL.md`, `requirements.txt`, `bootstrap.sh`, `dfp.sh`, `NOTICE.md`, `dfp/`, `assets/`. It writes nothing inside itself and references nothing outside it. Project docs such as this guide live outside it. `bash tools/package.sh` builds `dist/design-from-pdf.zip` and refuses stray files. PyMuPDF is AGPL-licensed; see `NOTICE.md`.
