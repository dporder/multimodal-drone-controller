#!/usr/bin/env python3
"""Run a swarm simulator.

    python main.py                 # Swarm Mind in the browser (served on localhost)
    python main.py seek            # Swarm Seek
    python main.py guard           # Swarm Guard
    python main.py mind --port 9000
    python main.py mind --headless 300   # physics only, no browser, 300 simulated seconds (needs node)

The page is served from a local HTTP server so the Live brain link (websocket)
works and the browser treats it as a normal site. Ctrl-C stops the server.
"""
import argparse
import http.server
import os
import socketserver
import subprocess
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
SIMS = {"mind": "swarm-mind", "seek": "swarm-seek", "guard": "swarm-guard"}


def serve(sim: str, port: int, open_browser: bool) -> None:
    folder = os.path.join(ROOT, "simulators")
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=folder, **k)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        url = f"http://127.0.0.1:{port}/{SIMS[sim]}/index.html"
        print(f"Serving {folder}\nOpen {url}\nCtrl-C to stop.")
        if open_browser:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


def headless(sim: str, seconds: int) -> int:
    script = os.path.join(ROOT, "simulators", "tests", "headless.js")
    try:
        return subprocess.call(["node", script, sim, str(seconds)])
    except FileNotFoundError:
        print("node is required for the headless run: https://nodejs.org", file=sys.stderr)
        return 1


def main() -> None:
    p = argparse.ArgumentParser(description="Run a swarm simulator")
    p.add_argument("sim", nargs="?", default="mind", choices=sorted(SIMS), help="which simulator (default: mind)")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-browser", action="store_true", help="serve only, do not open a browser")
    p.add_argument("--headless", nargs="?", const=150, type=int, metavar="SECONDS", help="run the physics core in node without a browser")
    a = p.parse_args()
    if a.headless is not None:
        sys.exit(headless(a.sim, a.headless))
    serve(a.sim, a.port, not a.no_browser)


if __name__ == "__main__":
    main()
