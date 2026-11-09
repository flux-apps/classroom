# Classroom Design System

A hybrid for a Spanish-classroom product: the **infinite lesson board**, the **stream, banners and tabs**, the **topic sections and activity completion**, all wearing the **printed-coursebook character** (ink on paper, one accent per section, tilted title tags, slanted side tabs, handwritten notes).

`/mockups-creating` and builders design against this directory instead of inventing values. Open `styles.css` for the tokens and `components/*/*.card.html` for live specimens.

## Content fundamentals

Inherited from the book and the board spec.

- **Language.** Spanish first, English second, **both always** on board chrome (`BilingualLabel`, `ToolButton en=`, `NoticeBanner`). The course hub is Spanish only in sample data.
- **Voice.** Instructions are imperative and informal, plural for group work: "Lee y relaciona cada imagen…", "Relacionad cada tipo de enlace…". Questions and exclamations carry inverted marks: "¿Qué tipo de fiesta organizarías?", "¡Sorpresa!".
- **Casing.** Sentence case everywhere, titles included ("¡Qué fiesta!", "Trabajo de clase"). Capitals only for tiny labels (`t-caption`, `Badge`) and "UNIDAD 5".
- **Emphasis.** The learner's language is *italic example-blue*; the form under study is **bold**: "Ayer **estuve** en una fiesta."
- **No emoji, no exclamation spam.** Warmth comes from the handwriting face and tilt, not from emoji.
- **Microcopy under inputs** is one short helper line, bilingual where it is board chrome.
- **Never imply the board is a book.** The PDF card is "Abrir libro / Open book"; a web card is "Tarjeta web", never "Libro".

## Visual foundations

**Colour.** Ink `#231F20` on paper `#FFFFFF`. Chrome is neutral and quiet ("neutral chrome, saturated content"); colour is functional. Steel blue `#2F5C93` is the action, example blue `#0072BC` is selection/focus/learner language. Seven **section accents** (lime, green, orange, magenta, blue, purple, teal) colour one section at a time: banner, tab, heading, bar, progress, icon tiles. Every accent travels with a **shape** (`Marker`: cross, circle, triangle, diamond, square, hexagon, pentagon) so colour is never the only signal. Tints are computed (`color-mix` 14% on white). Feedback: green success, orange warning, red error, blue info, always with icon or word.

**Type.** Fira Sans (substitute for the book's Officina Sans) for everything; Patrick Hand (substitute for its handwriting faces) only for human notes. Scale 44/32/24/20/16/14/12; board labels 18, board titles 28. Titles bold, labels medium, no all-caps except captions. Oversized lowercase numerals (`t-giant`, 160px) may head a unit.

**Spacing.** 4px base (4…64). Touch targets 56 minimum, 64 at 1280–1599, 72 at ≥1600; desktop controls 40. Board grid 24px dots; notebook rule 24px.

**Backgrounds.** Warm canvas `#F6F4EF` with a **dot grid** for the board, white paper for pages and cards, **ruled notebook** (24px lavender lines) for lined cards. Pale tint bands for callouts. Section banners are flat accent colour with two translucent **paper cut-out circles** (no photos, no gradients). No full-bleed imagery in UI chrome.

**Motion.** Subtle and short: 120/200/320ms, `cubic-bezier(.2,.8,.2,1)` (and Material standard `.4,0,.2,1` for accordions). Colour/shadow/border changes, chevron rotation, progress width. No bounces, no parallax; `prefers-reduced-motion` zeroes durations. The board never animates objects while the teacher draws.

**Hover and press.** Hover: darker fill (action → navy) or sunken tint; cards and rows take a **2px accent edge** that is transparent at rest, so nothing shifts. Press: 1px sink with an inset shadow (`--shadow-press`). Selected tool: tinted tile + accent icon + **4px underbar**. Focus: stacked ring, 2px white + 3px example-blue.

**Borders.** 1px hairline `#DDD9CE` for quiet structure, 1.33px for outlined controls, 2px for dashed add-slots and selected objects, 4px accent rule on the tilted title tag.

**Shadows.** Five: `soft` (book's 0.35 opacity), `note` (sticky), `card` (two-layer, tinted umbra rgba(60,64,67)), `dock` (three-layer: contact, mid, long), `dialog`. Tinted, never pure black. Inside a card, depth also comes from a **well**: white header over a canvas-coloured body with white rows.

**Protection and transparency.** Scrim `rgba(ink,.5)` behind dialogs; `--glass` white 75% reserved for floating labels over imagery. No blur effects.

**Layout rules.** Board: floating docks inset 16px from the edge (not full-height panels), zoom cluster bottom-right, status chips bottom-left, objects free on the plane. Hub: 64px top bar, 264px drawer, 720px centred stream column. Section tab sits on the outer edge of a page/object. One tilted title tag per view.

**Imagery colour.** Warm, paper-like, flat fills; photographs (when a customer supplies them) get the book's 3pt white frame, 6.67px radius and soft shadow. No stock-kid photos, no 3D blobs, no purple-to-blue gradients.

**Corner radii.** 0 hairline panels · 4 notes/tags/checkboxes · 6.67 photos · 8 cards/buttons/inputs · 16 docks, sections, tinted callouts · 22.67 bubbles · pill for chips, badges, switches. Selection handles are round (touch-friendly).

**Cards.** White, 8px radius, `shadow-card`, 24px padding; outline variant = 1px hairline, no shadow; lined variant = ruled notebook with 4px radius; tinted variant = accent 14% fill, 16px radius, no shadow (the book's grammar box).

### The signature touches (what makes it ours)

1. **Etiqueta torcida / tilted title tag** — white tag rotated -3° with a 4px accent left edge on an accent bar (`TitleTag`, also the `CourseBanner` title).
2. **Pestaña / slanted tab** — vertical tab whose bottom edge is slightly slanted (`SectionTab`, section bars, object tabs).
3. **Subrayado de tiza / chalk underline** — a 2px wavy accent underline marks the active tab/nav item.
4. **Marca / shape markers** — a different shape for every accent.
5. **Cinta / washi tape** on stickies and **cuaderno** rules on lined cards.
6. **Bilingual stack** — ES over EN as a visual rhythm, not a translation afterthought.
7. **Cut-out circles / blobs** (`.ds-cutout`) instead of illustrations.

## Iconography

Lucide (ISC licence) SVGs copied to `assets/icons/` (58 icons) and drawn via CSS `mask-image`, so they take `currentColor`; use `<Icon name="pen" />` or `<span class="ic ic-pen">`. 1.5px stroke, 24px grid, 28px in board tools, 18–22px in the hub. No emoji, no unicode glyph icons (only ▲▼ in deltas, paired with colour). **Flag:** this is a CDN-matched stand-in; the codebase has no icon set yet. No logo exists: the product name is set in Fira Sans bold (see the course top bar); do not draw a mark.

## Index

| Path | What |
|---|---|
| `styles.css` | `@import` list only |
| `tokens/` | `colors`, `typography`, `spacing`, `radii`, `elevation` (+motion), `roles` (semantic + signature), `icons`, `fonts`, `base` (text roles, board/notebook surfaces, chalk) |
| `assets/fonts/` | Fira Sans 400/500/700/400i, Patrick Hand 400 (latin woff2) |
| `assets/icons/` | 58 Lucide SVGs |
| `components/primitives/` | Icon, Button, IconButton, Badge, Tag, Card, Marker, BilingualLabel, TitleTag, SectionTab |
| `components/forms/` | Field, Input, Select, Checkbox, Radio, Switch |
| `components/feedback/` | Dialog, Toast, Tooltip, ProgressBar, CompletionCheck |
| `components/navigation/` | Tabs, NavItem |
| `components/board/` | ToolButton, ToolDock, ZoomControl, StickyNote, ObjectCard, Frame, OverlayChip, NoticeBanner |
| `components/course/` | CourseBanner, StreamPost, SectionAccordion, ActivityRow, AddSlot, StatPanel |
| `components/<group>/<group>.card.html` | one live card per directory (6) |
| `guidelines/*.card.html` | 16 specimen cards: colours (5), type (3), spacing (2), shape (2), brand (4) |
| `ui_kits/board/` | lesson board: notice, tools, objects, PDF viewer, clear dialog |
| `ui_kits/course/` | course hub (concept): drawer, banner, tabs, stream, sections, completion |
| `_ds_preview.js` | no-build component loader for the cards |

## Intentional additions (no counterpart in the book)

- Web UI components: the book has none; **every** button, input, dock and accordion is new, built from tokens plus the reference patterns above.
- Neutral surfaces `canvas #F6F4EF`, `canvas-deep`, `line`, `line-strong`, `ink-2` (the book is ink on white).
- Steel blue as the action colour (the book uses it for folios/structure).
- `Marker` shapes, `Frame`, `ZoomControl`, `OverlayChip`, `StatPanel`, `AddSlot`, `CompletionCheck labelled`: from the references / board spec.
- Washi tape on stickies, `t-giant`, `.ds-cutout`: inspired by the Behance study (Classly, Praktika), not from the book.
- The **course hub kit** is a concept: the product spec has no student/course screens.

## Caveats

- **Fonts:** Fira Sans / Patrick Hand are substitutes for the book's Officina Sans and handwriting faces; Google fonts files are copied locally (latin subset). Ask for the real files if they exist.
- **Board label size:** `ToolButton` labels are 14px ES + 11px EN inside 64–72px tiles, below the 18px board-label token. Consider wider tiles on 1600+ if the teacher cannot read them from the board distance.
- **Adherence lint:** design tools may write an `_adherence.oxlintrc.json`; it cannot run in oxlint (`no-restricted-syntax` is unsupported) — port its rules to ESLint instead.
