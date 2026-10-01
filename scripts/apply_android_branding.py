#!/usr/bin/env python3
"""Apply ViewInvAI launcher branding to a generated Capacitor Android project.

Uses only the Python standard library so GitHub Actions does not need image tooling.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"

BG = (8, 19, 27, 255)
BORDER = (49, 80, 98, 255)
GRID = (49, 80, 98, 140)
TEAL = (67, 228, 178, 255)
TEAL_LIGHT = (141, 245, 213, 255)
RED = (255, 99, 110, 255)
TRANSPARENT = (0, 0, 0, 0)

# Candlestick mark in favicon.svg coordinates (64x64). Keep both in sync.
# Wicks: (x, y_top, y_bottom, color); bodies: (x, y, width, height, color).
WICK_WIDTH = 2.6
WICKS = [(18, 32, 52, TEAL), (32, 23, 45, RED), (46, 11, 41, TEAL)]
BODIES = [(13, 36, 10, 12, TEAL), (27, 27, 10, 12, RED), (41, 15, 10, 21, TEAL_LIGHT)]
BODY_RADIUS = 2.0
GRID_YS = (22, 32, 42)
SUPERSAMPLE = 4


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, pixels: list[tuple[int, int, int, int]]) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        row = pixels[y * size : (y + 1) * size]
        for rgba in row:
            raw.extend(rgba)
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def in_rounded_rect(x: float, y: float, rx: float, ry: float, w: float, h: float, r: float) -> bool:
    if not (rx <= x <= rx + w and ry <= y <= ry + h):
        return False
    cx = min(max(x, rx + r), rx + w - r)
    cy = min(max(y, ry + r), ry + h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def blend(dst: tuple[int, int, int, int], src: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    a = src[3] / 255
    if a >= 1 or dst[3] == 0:
        return src
    return (
        round(src[0] * a + dst[0] * (1 - a)),
        round(src[1] * a + dst[1] * (1 - a)),
        round(src[2] * a + dst[2] * (1 - a)),
        dst[3],
    )


def sample(u: float, v: float, round_icon: bool) -> tuple[int, int, int, int]:
    """Colour at (u, v) in the 64x64 favicon space."""
    if round_icon:
        d = math.hypot(u - 32, v - 32)
        if d > 30.5:
            return TRANSPARENT
        color = BORDER if d > 27.5 else BG
    else:
        if not in_rounded_rect(u, v, 1.5, 1.5, 61, 61, 16.5):
            return TRANSPARENT
        color = BG if in_rounded_rect(u, v, 4.5, 4.5, 55, 55, 13.5) else BORDER
    if color is BORDER:
        return color

    if 10 <= u <= 54 and any(abs(v - gy) <= 0.5 for gy in GRID_YS):
        color = blend(color, GRID)
    for x, top, bottom, wick_color in WICKS:
        half = WICK_WIDTH / 2
        if abs(u - x) <= half and top - half <= v <= bottom + half:
            if top <= v <= bottom or math.hypot(u - x, v - (top if v < top else bottom)) <= half:
                color = wick_color
    for x, y, w, h, body_color in BODIES:
        if in_rounded_rect(u, v, x, y, w, h, BODY_RADIUS):
            color = body_color
    return color


def make_icon(size: int, round_icon: bool = False) -> list[tuple[int, int, int, int]]:
    scale = 64 / size
    n = SUPERSAMPLE
    pixels: list[tuple[int, int, int, int]] = []
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
                pixels.append((
                    round(acc[0] / acc[3]),
                    round(acc[1] / acc[3]),
                    round(acc[2] / acc[3]),
                    round(acc[3] / (n * n)),
                ))
    return pixels


def remove_existing_launcher_variants(folder: Path) -> None:
    if not folder.exists():
        return
    for pattern in ("ic_launcher.*", "ic_launcher_round.*"):
        for path in folder.glob(pattern):
            path.unlink()


def write_legacy_icons() -> None:
    sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder_name, size in sizes.items():
        folder = RES / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        remove_existing_launcher_variants(folder)
        write_png(folder / "ic_launcher.png", size, make_icon(size, False))
        write_png(folder / "ic_launcher_round.png", size, make_icon(size, True))


def hex_color(rgba: tuple[int, int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}{:02X}".format(rgba[3], rgba[0], rgba[1], rgba[2])


def rounded_rect_path(x: float, y: float, w: float, h: float, r: float) -> str:
    f = lambda n: f"{n:.2f}".rstrip("0").rstrip(".")
    return (
        f"M{f(x + r)},{f(y)} H{f(x + w - r)} A{f(r)},{f(r)} 0 0 1 {f(x + w)},{f(y + r)} "
        f"V{f(y + h - r)} A{f(r)},{f(r)} 0 0 1 {f(x + w - r)},{f(y + h)} "
        f"H{f(x + r)} A{f(r)},{f(r)} 0 0 1 {f(x)},{f(y + h - r)} "
        f"V{f(y + r)} A{f(r)},{f(r)} 0 0 1 {f(x + r)},{f(y)} Z"
    )


def adaptive_foreground_xml() -> str:
    """Candlestick mark centred in the 108dp adaptive canvas, inside the 66dp safe zone."""
    k = 1.35
    tx = lambda u: 54 + (u - 32) * k
    paths = []
    for gy in GRID_YS:
        paths.append((GRID, rounded_rect_path(tx(10), tx(gy) - 0.5 * k, 44 * k, 1 * k, 0.01)))
    half = WICK_WIDTH / 2
    for x, top, bottom, color in WICKS:
        paths.append((color, rounded_rect_path(tx(x - half), tx(top - half), WICK_WIDTH * k, (bottom - top + WICK_WIDTH) * k, half * k)))
    for x, y, w, h, color in BODIES:
        paths.append((color, rounded_rect_path(tx(x), tx(y), w * k, h * k, BODY_RADIUS * k)))
    body = "".join(
        f'    <path\n        android:fillColor="{hex_color(color)}"\n        android:pathData="{data}" />\n'
        for color, data in paths
    )
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="108dp"\n'
        '    android:height="108dp"\n'
        '    android:viewportWidth="108"\n'
        '    android:viewportHeight="108">\n'
        f"{body}"
        "</vector>\n"
    )


def write_adaptive_icon() -> None:
    values = RES / "values"
    drawable = RES / "drawable"
    adaptive = RES / "mipmap-anydpi-v26"
    values.mkdir(parents=True, exist_ok=True)
    drawable.mkdir(parents=True, exist_ok=True)
    adaptive.mkdir(parents=True, exist_ok=True)

    (values / "viewinvai_icon_colors.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="viewinvai_icon_background">#08131B</color>
</resources>
""",
        encoding="utf-8",
    )

    (drawable / "viewinvai_foreground.xml").write_text(adaptive_foreground_xml(), encoding="utf-8")

    adaptive_xml = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/viewinvai_icon_background" />
    <foreground android:drawable="@drawable/viewinvai_foreground" />
</adaptive-icon>
"""
    remove_existing_launcher_variants(adaptive)
    (adaptive / "ic_launcher.xml").write_text(adaptive_xml, encoding="utf-8")
    (adaptive / "ic_launcher_round.xml").write_text(adaptive_xml, encoding="utf-8")


def main() -> None:
    if not RES.exists():
        raise SystemExit(f"Android resources not found: {RES}. Run 'npx cap add android' first.")
    write_legacy_icons()
    write_adaptive_icon()
    print("ViewInvAI Android launcher icons applied.")


if __name__ == "__main__":
    main()
