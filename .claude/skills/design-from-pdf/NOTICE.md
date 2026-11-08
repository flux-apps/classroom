# Third-party notices

## PyMuPDF (AGPL-3.0)

The `dfp` tools read PDFs with **PyMuPDF** (`pymupdf`), published by Artifex under the GNU AGPL-3.0
(or a commercial licence). It is **not vendored** and **not redistributed** in this package: `bootstrap.sh`
installs the pinned wheel from PyPI into a virtual environment on the user's own machine, outside this
directory. Whoever runs the skill obtains PyMuPDF directly from its publisher under its own terms.

All PDF access is confined to `dfp/pdfio.py`, `dfp/probe.py`, `dfp/extract.py`, `dfp/cluster.py` and
`dfp/render.py`, so the library can be swapped without touching the rest. If you distribute a product that
bundles PyMuPDF, review the AGPL (or buy the commercial licence) first. This notice is not legal advice.

## Pillow (HPND)

`pillow` is installed the same way (pinned in `requirements.txt`) and is used for image sampling and for the
side-by-side verification sheets.

## assets/ds-preview.js

A copy of the `ds-preview.js` runtime shipped with the `/design-generating` skill, bundled so this skill
installs on its own. Copied from the Talaka kit at commit `6e003f1da00e1b02079e42403e58b3eff5eea745`
(sha256 `afd22f89b2d5b05688cb0067fcd3d4c7b81091a76cf4abf507f01929096030e8`). It is refreshed by hand; it can
drift from the original, so compare the sha256 above before assuming they match. Set `DFP_PREVIEW_JS` to use a
different copy.

## Source documents

The skill never ships fonts or content images taken from a source PDF. Fonts are replaced by Google Fonts
substitutes (loaded from Google's servers by the generated CSS); content photos stay out of the output.
