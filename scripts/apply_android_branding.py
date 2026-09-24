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

BG = (7, 16, 24, 255)
BORDER = (49, 80, 98, 255)
TEAL = (67, 228, 178, 255)
TEAL_LIGHT = (141, 245, 213, 255)
TRANSPARENT = (0, 0, 0, 0)


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


def rounded_rect_contains(x: float, y: float, size: int, radius: float) -> bool:
    if radius <= x <= size - radius or radius <= y <= size - radius:
        return 0 <= x < size and 0 <= y < size
    cx = radius if x < radius else size - radius
    cy = radius if y < radius else size - radius
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def distance_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    vv = vx * vx + vy * vy
    if vv == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / vv))
    cx, cy = ax + t * vx, ay + t * vy
    return math.hypot(px - cx, py - cy)


def make_icon(size: int, round_icon: bool = False) -> list[tuple[int, int, int, int]]:
    radius = size * 0.22
    border = max(1.0, size * 0.025)
    cx = cy = size / 2
    outer_circle = size * 0.49
    inner_circle = outer_circle - border
    line_width = max(2.0, size * 0.055)

    left_a = (size * 0.29, size * 0.29)
    center_b = (size * 0.50, size * 0.72)
    right_a = (size * 0.72, size * 0.29)

    diamond_cx, diamond_cy = size * 0.78, size * 0.23
    diamond_r = size * 0.055

    pixels: list[tuple[int, int, int, int]] = []
    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5

            if round_icon:
                d = math.hypot(px - cx, py - cy)
                if d > outer_circle:
                    color = TRANSPARENT
                elif d > inner_circle:
                    color = BORDER
                else:
                    color = BG
            else:
                inside = rounded_rect_contains(px, py, size, radius)
                inside_inner = rounded_rect_contains(px, py, size, max(1.0, radius - border))
                if not inside:
                    color = TRANSPARENT
                elif not inside_inner or px < border or py < border or px > size - border or py > size - border:
                    color = BORDER
                else:
                    color = BG

            if color[3]:
                if (
                    distance_to_segment(px, py, *left_a, *center_b) <= line_width / 2
                    or distance_to_segment(px, py, *center_b, *right_a) <= line_width / 2
                ):
                    color = TEAL

                if abs(px - diamond_cx) + abs(py - diamond_cy) <= diamond_r:
                    color = TEAL_LIGHT

            pixels.append(color)

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
    <color name="viewinvai_icon_background">#071018</color>
</resources>
""",
        encoding="utf-8",
    )

    (drawable / "viewinvai_foreground.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#43E4B2"
        android:pathData="M27,30 L36,30 L54,69 L50,80 Z" />
    <path
        android:fillColor="#43E4B2"
        android:pathData="M72,30 L81,30 L58,80 L50,80 Z" />
    <path
        android:fillColor="#8DF5D5"
        android:pathData="M84,18 L90,24 L84,30 L78,24 Z" />
</vector>
""",
        encoding="utf-8",
    )

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
