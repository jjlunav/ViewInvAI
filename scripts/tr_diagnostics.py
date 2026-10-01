#!/usr/bin/env python3
"""Diagnose the Trade Republic / LSX price feed from outside Cloudflare.

1. Asks the deployed Worker for /api/tr-health (its own view of the feed).
2. Connects straight to Trade Republic with each known handshake and requests
   one ticker, printing exactly what comes back.
"""
import asyncio
import json
import http.client

import websockets

WORKER_HOST = "viewinvai.sonarlab.workers.dev"
ISIN = "US0378331005"
HANDSHAKES = [
    "connect 30",
    "connect 31 " + json.dumps({"locale": "es", "platformId": "webtrading", "platformVersion": "chrome - 120.0.0",
                                "clientId": "app.traderepublic.com", "clientVersion": "3.151.3"}),
]


def worker_health():
    conn = http.client.HTTPSConnection(WORKER_HOST, timeout=30)
    try:
        conn.request("GET", "/api/tr-health", headers={"User-Agent": "ViewInvAI-diagnostics"})
        r = conn.getresponse()
        print("Worker /api/tr-health", r.status, r.read().decode()[:600])
    except Exception as e:  # noqa: BLE001 - diagnostics print every failure
        print("Worker /api/tr-health ERROR", repr(e))
    finally:
        conn.close()


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


async def via_worker(origin):
    """Same path the app uses: the Worker's /api/tr-live WebSocket bridge."""
    label = "Worker origin=" + (origin or "-")
    try:
        async with websockets.connect("wss://viewinvai.sonarlab.workers.dev/api/tr-live", origin=origin,
                                      user_agent_header="Mozilla/5.0", open_timeout=15) as ws:
            await ws.send("connect 30")
            hello = await asyncio.wait_for(ws.recv(), 15)
            print(label, "-> saludo:", str(hello)[:200])
            await ws.send("sub 1 " + json.dumps({"type": "ticker", "id": ISIN + ".LSX"}))
            msg = await asyncio.wait_for(ws.recv(), 15)
            print(label, "-> ticker:", str(msg)[:200])
    except Exception as e:  # noqa: BLE001
        print(label, "-> ERROR", repr(e)[:400])


if __name__ == "__main__":
    worker_health()
    for h in HANDSHAKES:
        asyncio.run(direct(h))
    for o in ("https://localhost", "https://viewinvai.sonarlab.workers.dev", None):
        asyncio.run(via_worker(o))
