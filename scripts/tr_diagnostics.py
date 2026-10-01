#!/usr/bin/env python3
"""Diagnose the Trade Republic / LSX price feed from outside Cloudflare.

1. Asks the deployed Worker for /api/tr-health (its own view of the feed).
2. Connects straight to Trade Republic with each known handshake and requests
   one ticker, printing exactly what comes back.
"""
import asyncio
import json
import urllib.request

import websockets

WORKER = "https://viewinvai.sonarlab.workers.dev/api/tr-health"
ISIN = "US0378331005"
HANDSHAKES = [
    "connect 30",
    "connect 31 " + json.dumps({"locale": "es", "platformId": "webtrading", "platformVersion": "chrome - 120.0.0",
                                "clientId": "app.traderepublic.com", "clientVersion": "3.151.3"}),
]


def worker_health():
    try:
        with urllib.request.urlopen(urllib.request.Request(WORKER, headers={"User-Agent": "ViewInvAI-diagnostics"}), timeout=30) as r:
            print("Worker /api/tr-health", r.status, r.read().decode()[:600])
    except Exception as e:  # noqa: BLE001 - diagnostics print every failure
        body = getattr(e, "read", lambda: b"")()
        print("Worker /api/tr-health ERROR", repr(e), body[:300])


async def direct(handshake):
    label = handshake.split(" ", 2)[:2]
    try:
        async with websockets.connect("wss://api.traderepublic.com", origin="https://app.traderepublic.com",
                                      user_agent_header="Mozilla/5.0", open_timeout=15) as ws:
            await ws.send(handshake)
            hello = await asyncio.wait_for(ws.recv(), 10)
            print("Directo", " ".join(label), "-> saludo:", str(hello)[:200])
            if not str(hello).startswith("connected"):
                return
            await ws.send("sub 1 " + json.dumps({"type": "ticker", "id": ISIN + ".LSX"}))
            for _ in range(3):
                msg = await asyncio.wait_for(ws.recv(), 10)
                print("Directo", " ".join(label), "-> ticker:", str(msg)[:300])
                if str(msg).startswith("1 A") or str(msg).startswith("1 E"):
                    break
    except Exception as e:  # noqa: BLE001
        print("Directo", " ".join(label), "-> ERROR", repr(e)[:300])


if __name__ == "__main__":
    worker_health()
    for h in HANDSHAKES:
        asyncio.run(direct(h))
