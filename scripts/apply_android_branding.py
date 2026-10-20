#!/usr/bin/env python3
"""Apply ViewInvAI launcher branding to a generated Capacitor Android project.

Uses only the Python standard library so GitHub Actions does not need image tooling.
The mark is the same as favicon.svg / favicon-light.svg: a solid «V» drawn as a chart
line that drops and rebounds, plus the AI dot (violet → teal) on a deep navy tile.
Run with --svg to regenerate both favicons from this geometry.
"""

from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"

TRANSPARENT = (0, 0, 0, 0)
BORDER = (49, 80, 98, 255)          # #315062
MARK = (234, 244, 248, 255)         # #eaf4f8
BG_STOPS = [(0.0, (22, 49, 74)), (0.45, (10, 26, 42)), (1.0, (5, 13, 21))]  # #16314a #0a1a2a #050d15
AI_FROM, AI_TO = (157, 140, 255), (67, 228, 178)                            # #9d8cff → #43e4b2

# Geometry in favicon space (64 × 64).
LINE = [(12.0, 20.0), (25.0, 45.0), (36.0, 27.0), (42.0, 35.0)]
LINE_WIDTH = 7.5
DOT = (49.0, 21.0, 6.2)
BG_CENTER, BG_RADIUS = (0.85 * 64, 0.0), 1.1 * 64
ROUND_MARK_SCALE = 0.88
SUPERSAMPLE = 4


def _offset_point(points, i, side, half):
    """Miter-joined offset of vertex i to one side of the polyline."""
    def normal(a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        return (-dy / length * side, dx / length * side)
    p = points[i]
    if i == 0:
        n = normal(points[0], points[1])
        return (p[0] + n[0] * half, p[1] + n[1] * half)
    if i == len(points) - 1:
        n = normal(points[-2], points[-1])
        return (p[0] + n[0] * half, p[1] + n[1] * half)
    n1, n2 = normal(points[i - 1], p), normal(p, points[i + 1])
    mx, my = n1[0] + n2[0], n1[1] + n2[1]
    ml = math.hypot(mx, my)
    mx, my = mx / ml, my / ml
    scale = half / (mx * n1[0] + my * n1[1])
    return (p[0] + mx * scale, p[1] + my * scale)


def stroke_polygon(points=LINE, width=LINE_WIDTH):
    half = width / 2
    left = [_offset_point(points, i, 1, half) for i in range(len(points))]
    right = [_offset_point(points, i, -1, half) for i in range(len(points))]
    return left + right[::-1]


POLY = stroke_polygon()


def in_polygon(x, y, poly=POLY):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def lerp(a, b, t):
    return tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3))


def background(u, v):
    t = min(1.0, math.hypot(u - BG_CENTER[0], v - BG_CENTER[1]) / BG_RADIUS)
    for (t0, c0), (t1, c1) in zip(BG_STOPS, BG_STOPS[1:]):
        if t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0)) + (255,)
    return BG_STOPS[-1][1] + (255,)


def ai_color(u, v):
    cx, cy, r = DOT
    # Gradient from the dot's bottom-left to its top-right corner (as in the SVG).
    x0, y0, x1, y1 = cx - r, cy + r, cx + r, cy - r
    dx, dy = x1 - x0, y1 - y0
    t = max(0.0, min(1.0, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy)))
    return lerp(AI_FROM, AI_TO, t) + (255,)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, pixels) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for rgba in pixels[y * size:(y + 1) * size]:
            raw.extend(rgba)
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def in_rounded_rect(x, y, rx, ry, w, h, r) -> bool:
    if not (rx <= x <= rx + w and ry <= y <= ry + h):
        return False
    cx = min(max(x, rx + r), rx + w - r)
    cy = min(max(y, ry + r), ry + h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def sample(u: float, v: float, round_icon: bool):
    """Colour at (u, v) in the 64x64 favicon space."""
    if round_icon:
        d = math.hypot(u - 32, v - 32)
        if d > 32:
            return TRANSPARENT
        if d > 30:
            return BORDER
        u, v = 32 + (u - 32) / ROUND_MARK_SCALE, 32 + (v - 32) / ROUND_MARK_SCALE
    else:
        if not in_rounded_rect(u, v, 0, 0, 64, 64, 14):
            return TRANSPARENT
        if not in_rounded_rect(u, v, 2, 2, 60, 60, 12):
            return BORDER
    if in_polygon(u, v):
        return MARK
    cx, cy, r = DOT
    if (u - cx) ** 2 + (v - cy) ** 2 <= r * r:
        return ai_color(u, v)
    return background(u, v)


def make_icon(size: int, round_icon: bool = False):
    scale = 64 / size
    n = SUPERSAMPLE
    pixels = []
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(n):
                for sx in range(n):
                    c = sample((x + (sx + 0.5) / n) * scale, (y + (sy + 0.5) / n) * scale, round_icon)
                    a = c[3]
                    acc[0] += c[0] * a
                    acc[1] += c[1] * a
                    acc[2] += c[2] * a
                    acc[3] += a
            if acc[3] == 0:
                pixels.append(TRANSPARENT)
            else:
                pixels.append((round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(acc[3] / (n * n))))
    return pixels


def remove_existing_launcher_variants(folder: Path) -> None:
    if not folder.exists():
        return
    for pattern in ("ic_launcher.*", "ic_launcher_round.*"):
        for path in folder.glob(pattern):
            path.unlink()


def write_legacy_icons() -> None:
    sizes = {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}
    for folder_name, size in sizes.items():
        folder = RES / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        remove_existing_launcher_variants(folder)
        write_png(folder / "ic_launcher.png", size, make_icon(size, False))
        write_png(folder / "ic_launcher_round.png", size, make_icon(size, True))


def fmt(n: float) -> str:
    return f"{n:.2f}".rstrip("0").rstrip(".")


def hexrgb(c) -> str:
    return "#{:02X}{:02X}{:02X}".format(*c[:3])


def poly_path(tx=lambda u: u) -> str:
    return "M" + " L".join(f"{fmt(tx(x))},{fmt(tx(y))}" for x, y in POLY) + " Z"


def circle_path(cx, cy, r) -> str:
    return f"M{fmt(cx - r)},{fmt(cy)} A{fmt(r)},{fmt(r)} 0 1 1 {fmt(cx + r)},{fmt(cy)} A{fmt(r)},{fmt(r)} 0 1 1 {fmt(cx - r)},{fmt(cy)} Z"


def adaptive_foreground_xml() -> str:
    """Mark centred in the 108dp adaptive canvas, inside the 66dp safe zone."""
    k = 1.15
    tx = lambda u: 54 + (u - 32) * k
    cx, cy, r = DOT
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    xmlns:aapt="http://schemas.android.com/aapt"\n'
        '    android:width="108dp" android:height="108dp"\n'
        '    android:viewportWidth="108" android:viewportHeight="108">\n'
        f'    <path android:fillColor="{hexrgb(MARK)}" android:pathData="{poly_path(tx)}" />\n'
        f'    <path android:pathData="{circle_path(tx(cx), tx(cy), r * k)}">\n'
        '        <aapt:attr name="android:fillColor">\n'
        f'            <gradient android:type="linear" android:startX="{fmt(tx(cx - r))}" android:startY="{fmt(tx(cy + r))}"'
        f' android:endX="{fmt(tx(cx + r))}" android:endY="{fmt(tx(cy - r))}"'
        f' android:startColor="{hexrgb(AI_FROM)}" android:endColor="{hexrgb(AI_TO)}" />\n'
        '        </aapt:attr>\n'
        '    </path>\n'
        '</vector>\n'
    )


def adaptive_background_xml() -> str:
    stops = BG_STOPS
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    xmlns:aapt="http://schemas.android.com/aapt"\n'
        '    android:width="108dp" android:height="108dp"\n'
        '    android:viewportWidth="108" android:viewportHeight="108">\n'
        '    <path android:pathData="M0,0 H108 V108 H0 Z">\n'
        '        <aapt:attr name="android:fillColor">\n'
        '            <gradient android:type="radial" android:centerX="92" android:centerY="0" android:gradientRadius="119">\n'
        + "".join(f'                <item android:offset="{t}" android:color="{hexrgb(c)}" />\n' for t, c in stops)
        + '            </gradient>\n'
        '        </aapt:attr>\n'
        '    </path>\n'
        '</vector>\n'
    )


def write_adaptive_icon() -> None:
    drawable = RES / "drawable"
    adaptive = RES / "mipmap-anydpi-v26"
    drawable.mkdir(parents=True, exist_ok=True)
    adaptive.mkdir(parents=True, exist_ok=True)
    (drawable / "viewinvai_foreground.xml").write_text(adaptive_foreground_xml(), encoding="utf-8")
    (drawable / "viewinvai_background.xml").write_text(adaptive_background_xml(), encoding="utf-8")
    adaptive_xml = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/viewinvai_background" />
    <foreground android:drawable="@drawable/viewinvai_foreground" />
</adaptive-icon>
"""
    remove_existing_launcher_variants(adaptive)
    (adaptive / "ic_launcher.xml").write_text(adaptive_xml, encoding="utf-8")
    (adaptive / "ic_launcher_round.xml").write_text(adaptive_xml, encoding="utf-8")


def notification_icon_xml() -> str:
    """Status bar / smartwatch icon: the same «V» and AI dot, white on transparent.

    Android (and the watches that mirror phone notifications) only use the alpha channel
    of the small icon; without one they show a blank square or a generic bell.
    """
    cx, cy, r = DOT
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="24dp" android:height="24dp"\n'
        '    android:viewportWidth="64" android:viewportHeight="64">\n'
        f'    <path android:fillColor="#FFFFFFFF" android:pathData="{poly_path()}" />\n'
        f'    <path android:fillColor="#FFFFFFFF" android:pathData="{circle_path(cx, cy, r)}" />\n'
        '</vector>\n'
    )


def write_notification_icon() -> None:
    drawable = RES / "drawable"
    values = RES / "values"
    drawable.mkdir(parents=True, exist_ok=True)
    values.mkdir(parents=True, exist_ok=True)
    (drawable / "ic_stat_viewinvai.xml").write_text(notification_icon_xml(), encoding="utf-8")
    (values / "viewinvai_notification.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="viewinvai_notification_accent">{hexrgb(AI_TO)}</color>\n'
        '</resources>\n', encoding="utf-8")


def favicon_svg(light: bool) -> str:
    cx, cy, r = DOT
    if light:
        tile = '<rect width="64" height="64" rx="14" fill="#ffffff"/><rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="#dde3ee" stroke-width="2"/>'
        mark, g0, g1, bg_defs = "#0f1e3a", "#4f46e5", "#14b8a6", ""
    else:
        bg_defs = ('<radialGradient id="bg" cx="0.85" cy="0" r="1.1">'
                   + "".join(f'<stop offset="{t}" stop-color="{hexrgb(c).lower()}"/>' for t, c in BG_STOPS)
                   + "</radialGradient>")
        tile = '<rect width="64" height="64" rx="14" fill="url(#bg)"/><rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="#315062" stroke-width="2"/>'
        mark, g0, g1 = hexrgb(MARK).lower(), hexrgb(AI_FROM).lower(), hexrgb(AI_TO).lower()
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
        "  <!-- ViewInvAI: «V» de gráfico que cae y rebota + punto de la IA. Generado con scripts/apply_android_branding.py (opción svg) -->\n"
        f'  <defs>{bg_defs}<linearGradient id="ai" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="{g0}"/><stop offset="1" stop-color="{g1}"/></linearGradient></defs>\n'
        f"  {tile}\n"
        f'  <path d="{poly_path()}" fill="{mark}"/>\n'
        f'  <circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}" fill="url(#ai)"/>\n'
        "</svg>\n"
    )


def main() -> None:
    if "--svg" in sys.argv:
        (ROOT / "favicon.svg").write_text(favicon_svg(False), encoding="utf-8")
        (ROOT / "favicon-light.svg").write_text(favicon_svg(True), encoding="utf-8")
        print("favicon.svg and favicon-light.svg regenerated.")
        return
    if not RES.exists():
        raise SystemExit(f"Android resources not found: {RES}. Run 'npx cap add android' first.")
    write_legacy_icons()
    write_adaptive_icon()
    write_notification_icon()
    print("ViewInvAI Android launcher and notification icons applied.")


if __name__ == "__main__":
    main()
