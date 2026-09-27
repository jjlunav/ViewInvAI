#!/usr/bin/env python3
"""Browser behavior regressions with synthetic data and production interactions.

This is not a visual audit of the complete app or a real Android-device test.
Requires Playwright and either an installed Chromium/Chrome or its bundled browser.
No external pages, accounts, market feeds or network requests are used by the fixture.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "tests/ui-continuity.html").read_text(encoding="utf-8")
source = (ROOT / "stock-interactions.js").read_text(encoding="utf-8")
marker = '<script src="stock-interactions.js"></script>'
if html.count(marker) != 1 or "</script" in source.lower():
    raise RuntimeError("Unexpected fixture or script boundary")
html = html.replace(marker, "<script>" + source + "</script>")
executable = os.environ.get("CHROME_BIN") or next(
    (found for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable")
     if (found := shutil.which(name))), None
)
reports = []
viewports = [("web", 1440)] + [(mode, width) for mode in ("web", "native-layout-flag") for width in (360, 390, 412)]
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=executable, headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"], timeout=30000,
    )
    try:
        for mode, width in viewports:
            context = browser.new_context(
                viewport={"width": width, "height": 900},
                locale="es-ES", timezone_id="Europe/Madrid", service_workers="block",
            )
            try:
                context.route("**/*", lambda route: route.abort())
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                markup = html.replace('<html lang="en">', '<html lang="en" data-native-app="1">') if mode != "web" else html
                page.set_content(markup, timeout=15000)
                page.wait_for_selector("html[data-result]", timeout=15000)
                report = json.loads(page.locator("#test-results").inner_text())
                report.update(mode=mode, width=width, pageErrors=errors)
                reports.append(report)
                passed = sum(bool(item.get("pass")) for item in report.get("results", []))
                print(f"{mode} {width}px: {passed}/{len(report.get('results', []))} passed", flush=True)
                for item in report.get("results", []):
                    if not item.get("pass"):
                        print("FAIL", item, flush=True)
            finally:
                context.close()
    finally:
        browser.close()

output = Path(os.environ.get("UI_TEST_REPORT", str(ROOT / "ui-regression-results.json")))
output.write_text(json.dumps(reports, indent=2), encoding="utf-8")
if not all(report.get("finished") and not report["pageErrors"]
           and len(report.get("results", [])) >= 29
           and all(item.get("pass") for item in report["results"]) for report in reports):
    raise SystemExit("UI continuity regressions failed")
print(json.dumps({"suite": "ui-continuity", "viewports": len(reports),
                  "passed": sum(len(report["results"]) for report in reports), "failed": 0}))
