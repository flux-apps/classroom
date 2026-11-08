"""Small pure helpers shared by dfp modules (no PDF access)."""
from __future__ import annotations

import colorsys
import re
import unicodedata


def compact_pages(pages):
    """[1,2,3,5,7,8] -> '1-3,5,7-8'"""
    pages = sorted({int(p) for p in pages})
    if not pages:
        return ""
    runs, start, prev = [], pages[0], pages[0]
    for p in pages[1:]:
        if p == prev + 1:
            prev = p
            continue
        runs.append((start, prev))
        start = prev = p
    runs.append((start, prev))
    return ",".join(str(a) if a == b else "%d-%d" % (a, b) for a, b in runs)


def evidence(pages, n=None, extra=None):
    """'p.1-3, n=6, extra' - page refs first so every observed item cites where it was seen."""
    parts = ["p.%s" % compact_pages(pages)] if pages else []
    if n is not None:
        parts.append("n=%d" % n)
    if extra:
        parts.append(extra)
    return ", ".join(parts)


def rgb_hex(rgb):
    """float 0..1 tuple (1, 3 or 4 components) -> '#RRGGBB'"""
    if rgb is None:
        return None
    vals = list(rgb)
    if len(vals) == 1:
        vals = vals * 3
    elif len(vals) == 4:                              # CMYK -> RGB (PyMuPDF normally converts already)
        c, m, y, k = vals
        vals = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]
    return "#%02X%02X%02X" % tuple(max(0, min(255, int(round(v * 255)))) for v in vals[:3])


def int_hex(value):
    return "#%06X" % (int(value) & 0xFFFFFF)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def color_name(hexv):
    """Rough human name for a colour; only a starting label that the checkpoint review renames."""
    r, g, b = hex_rgb(hexv)
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    deg = h * 360
    if v < 0.2:
        return "ink"
    if s < 0.04:
        if v > 0.96:
            return "white"
        if v > 0.8:
            return "light-grey"
        if v > 0.45:
            return "grey"
        return "dark-grey"
    if deg < 15 or deg >= 345:
        hue = "red"
    elif deg < 40:
        hue = "orange"
    elif deg < 65:
        hue = "yellow"
    elif deg < 160:
        hue = "green"
    elif deg < 200:
        hue = "teal"
    elif deg < 255:
        hue = "blue"
    elif deg < 290:
        hue = "purple"
    else:
        hue = "magenta"
    if s < 0.25 and v > 0.85:
        return hue + " tint"
    if v < 0.45:
        return "dark " + hue
    return hue


def slugify(text):
    """'Green / Tint (light)' -> 'green-tint-light'; accents folded, anything else dropped."""
    t = unicodedata.normalize("NFKD", str(text))
    t = t.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def fmt_num(x):
    """10.5 -> '10.5', 24.0 -> '24'"""
    return ("%g" % round(float(x), 2))


_PT = re.compile(r"^(-?\d+(?:\.\d+)?)pt$")


def _num3(x):
    s = ("%.3f" % x).rstrip("0").rstrip(".")
    return s if s not in ("-0", "") else "0"


def dual_units(value):
    """'10.5pt' -> '10.5pt (14px, 0.875rem)'. 1pt = 1.333px (4/3), 1rem = 16px, <= 3 decimals, trailing zeros cut.
    Anything that is not a plain pt length comes back unchanged."""
    v = str(value).strip()
    m = _PT.match(v)
    if not m:
        return v
    pt = float(m.group(1))
    px = pt * 4.0 / 3.0
    return "%spt (%spx, %srem)" % (m.group(1), _num3(px), _num3(px / 16.0))


def px_rem(pt):
    """pt (float) -> ('<px>px', '<rem>rem') as strings, same rounding as dual_units."""
    px = float(pt) * 4.0 / 3.0
    return "%spx" % _num3(px), "%srem" % _num3(px / 16.0)


def peak_memory_mb():
    """Peak resident memory of this process in MB, or None when the platform cannot report it. Never estimated."""
    try:
        import sys
        if sys.platform.startswith("win"):
            import ctypes
            from ctypes import wintypes

            class PMC(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                            ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                            ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
            k32 = ctypes.windll.kernel32
            k32.GetCurrentProcess.restype = wintypes.HANDLE
            psapi = ctypes.windll.psapi
            psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
            pmc = PMC()
            pmc.cb = ctypes.sizeof(PMC)
            if psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
                return round(pmc.PeakWorkingSetSize / 1048576.0, 1)
            return None
        import resource
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(rss / (1048576.0 if sys.platform == "darwin" else 1024.0), 1)
    except Exception:
        return None
