"""The single place that talks to PyMuPDF. Everything else in dfp works on plain dicts.

Open documents are never cached (an open handle would lock the file on Windows); only extracted data is, keyed by
file identity, so `analyze` does not pay for `get_drawings()` twice.
"""
from __future__ import annotations

import os
from pathlib import Path

import pymupdf

try:
    pymupdf.TOOLS.mupdf_display_errors(False)
except Exception:                                   # pragma: no cover - older/newer builds
    pass


class PdfBlocked(Exception):
    """The PDF cannot be analysed (encrypted, unreadable). `code` is stable: ENCRYPTED | UNREADABLE."""

    def __init__(self, code, message):
        super().__init__("%s: %s" % (code, message))
        self.code = code
        self.message = message


_CACHE = {}
_CACHE_MAX = 120          # ~40 pages x (drawings, text, images): flat memory for long documents, full reuse for short ones


def _remember(key, value):
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.clear()
    _CACHE[key] = value
    return value


class Pdf:
    """Context manager around an opened document with cached per-page extraction."""

    def __init__(self, path):
        p = Path(path)
        if not p.is_file():
            raise PdfBlocked("UNREADABLE", "not a file: %s" % p)
        try:
            st = os.stat(str(p))
            self.key = (str(p.resolve()), st.st_mtime_ns, st.st_size)
            self.doc = pymupdf.open(str(p))
        except Exception as exc:
            raise PdfBlocked("UNREADABLE", "cannot open %s (%s)" % (p.name, exc))
        if self.doc.needs_pass:
            self.doc.close()
            raise PdfBlocked("ENCRYPTED", "%s needs a password; remove the password and retry" % p.name)
        if self.doc.page_count == 0:
            self.doc.close()
            raise PdfBlocked("UNREADABLE", "%s has no pages" % p.name)
        self.path = p

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        try:
            self.doc.close()
        except Exception:
            pass

    @property
    def pages(self):
        return self.doc.page_count

    def page(self, pno):
        return self.doc[pno]

    def page_rect(self, pno):
        return self.doc[pno].rect

    def _cached(self, kind, pno, fn):
        k = (kind, self.key, pno)
        if k in _CACHE:
            return _CACHE[k]
        return _remember(k, fn(self.doc[pno]))

    def drawings(self, pno):
        return self._cached("draw", pno, lambda pg: pg.get_drawings())

    def text_dict(self, pno):
        # TEXTFLAGS_TEXT: the default flags also decode every image block (46 s vs 0.6 s on a 21 MB, 24-page book)
        return self._cached("text", pno, lambda pg: pg.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT))

    def image_info(self, pno):
        return self._cached("img", pno, lambda pg: pg.get_image_info())

    def text_chars(self, pno):
        n = 0
        for b in self.text_dict(pno).get("blocks", []):
            if b.get("type", 0) != 0:
                continue
            for ln in b.get("lines", []):
                for sp in ln.get("spans", []):
                    n += len(sp.get("text", "").strip())
        return n


def open_pdf(path):
    return Pdf(path)


def select_pages(total, pages=None):
    """1-based page list clipped to the document; None = all."""
    if pages is None:
        return list(range(1, total + 1))
    return sorted({int(p) for p in pages if 1 <= int(p) <= total})
