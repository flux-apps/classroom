"""AC3 Rendering: page images and element crops with PyMuPDF only (no poppler, no Cairo, no system tools)."""
from __future__ import annotations

from pathlib import Path

import pymupdf

from .pdfio import open_pdf, select_pages


def render_pages(pdf, out_dir, dpi=144, pages=None, progress=None):
    """Render 1-based `pages` (default all) to <out_dir>/page-001.png ...; returns the paths."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    with open_pdf(pdf) as doc:
        sel = select_pages(doc.pages, pages)
        for n in sel:
            p = out / ("page-%03d.png" % n)
            pix = doc.page(n - 1).get_pixmap(dpi=dpi, alpha=False)
            pix.save(str(p))
            del pix
            paths.append(p)
            if progress:
                progress(n, len(sel))
    return paths


def crop(pdf, page, bbox, out_path, dpi=144):
    """Render `bbox` (x0, y0, x1, y1 in PDF points) of 1-based `page` to `out_path`."""
    with open_pdf(pdf) as doc:
        return _crop(doc, page, bbox, out_path, dpi)


def _crop(doc, page, bbox, out_path, dpi):
    pg = doc.page(page - 1)
    clip = pymupdf.Rect(*bbox) & pg.rect
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if clip.is_empty:
        raise ValueError("empty crop region %s on page %d" % (list(bbox), page))
    pg.get_pixmap(dpi=dpi, clip=clip, alpha=False).save(str(out))
    return out


def crop_many(pdf, jobs, dpi=144):
    """jobs: iterable of (page, bbox, out_path). One open document; returns the paths that rendered."""
    done = []
    with open_pdf(pdf) as doc:
        for page, bbox, out_path in jobs:
            try:
                done.append(_crop(doc, page, bbox, out_path, dpi))
            except Exception:
                continue
    return done


# --------------------------------------------------------------------------- overlays (A23)
_STYLE = {"CMP": {"color": (0, 114, 178), "dash": None, "name": "component (CMP)"},
          "STR": {"color": (120, 60, 160), "dash": (14, 5, 3, 5), "name": "structure (STR)"},
          "UNC": {"color": (213, 94, 0), "dash": (10, 8), "name": "unclaimed (UNC)"}}


def _font(size):
    from PIL import ImageFont
    try:
        return ImageFont.load_default(size)
    except TypeError:                                  # Pillow < 10.1
        return ImageFont.load_default()


def _dashed_line(draw, p0, p1, color, width, pattern):
    (x0, y0), (x1, y1) = p0, p1
    length = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    if length <= 0:
        return
    if not pattern:
        draw.line([p0, p1], fill=color, width=width)
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    pos, i = 0.0, 0
    while pos < length:
        seg = pattern[i % len(pattern)]
        if i % 2 == 0:                                  # even entries draw, odd entries are gaps
            end = min(length, pos + seg)
            draw.line([(x0 + ux * pos, y0 + uy * pos), (x0 + ux * end, y0 + uy * end)], fill=color, width=width)
        pos += seg
        i += 1


def _box(draw, b, color, width, pattern):
    x0, y0, x1, y1 = b
    for p, q in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        _dashed_line(draw, p, q, color, width, pattern)


def _label(draw, xy, text, color, font):
    x, y = xy
    l, t, r, b = draw.textbbox((x, y), text, font=font)
    draw.rectangle([l - 3, t - 2, r + 3, b + 2], fill=(255, 255, 255))      # halo: legible on any background
    draw.rectangle([l - 3, t - 2, r + 3, b + 2], outline=color, width=1)
    draw.text((x, y), text, fill=color, font=font)


def render_overlays(pdf, out_dir, boxes, pages=None, long_edge=1600, progress=None):
    """One PNG per page: the page, the boxes of `boxes` ({page: [{id, kind CMP|STR|UNC, bbox, variant}]}) and a legend strip
    below. CMP solid, STR dash-dot, UNC dashed (meaning = line style + printed id; colour is a bonus). Long edge >= 1600 px."""
    from PIL import Image, ImageDraw
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    with open_pdf(pdf) as doc:
        sel = select_pages(doc.pages, pages)
        for n in sel:
            pg = doc.page(n - 1)
            r = pg.rect
            scale = max(1.0, float(long_edge) / max(r.width, r.height))
            pix = pg.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            page_im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            del pix
            w, h = page_im.size
            unit = max(1, int(round(w / 600.0)))
            strip = int(max(70, 38 * unit)) + 10 * unit
            im = Image.new("RGB", (w, h + strip), (255, 255, 255))
            im.paste(page_im, (0, 0))
            dr = ImageDraw.Draw(im)
            font = _font(max(12, 11 * unit))
            lw = max(2, 2 * unit)
            for b in (boxes or {}).get(n, []):
                st = _STYLE.get(b.get("kind"), _STYLE["CMP"])
                x0, y0, x1, y1 = [v * scale for v in b["bbox"]]
                _box(dr, (x0, y0, x1, y1), st["color"], lw, tuple(max(1, int(d * unit / 1.5)) for d in st["dash"]) if st["dash"] else None)
                text = b["id"] + (" " + b["variant"] if b.get("variant") else "")
                _label(dr, (min(max(2, x0 + 3), max(2, w - 8 * len(text) * unit)), max(2, y0 - 12 * unit - 4)), text, st["color"], font)
            y = h + strip // 2 - 6 * unit
            x = 12 * unit
            for kind in ("CMP", "STR", "UNC"):
                st = _STYLE[kind]
                _dashed_line(dr, (x, y + 6 * unit), (x + 60 * unit, y + 6 * unit), st["color"], lw + 1,
                             tuple(max(1, int(d * unit / 1.5)) for d in st["dash"]) if st["dash"] else None)
                dr.text((x + 66 * unit, y), "%s" % st["name"], fill=(30, 30, 30), font=font)
                x += 66 * unit + int(dr.textlength(st["name"], font=font)) + 28 * unit
            dr.text((12 * unit, h + strip - 14 * unit - 2), "page %d - line style carries the meaning, colour is a bonus" % n,
                    fill=(90, 90, 90), font=_font(max(11, 10 * unit)))
            p = out / ("overlay-%03d.png" % n)
            im.save(str(p))
            paths.append(p)
            if progress:
                progress(n, len(sel))
    return paths
