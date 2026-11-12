#!/usr/bin/env python3
"""Run a swarm simulator.

    python main.py                 # Swarm Mind in the browser (served on localhost)
    python main.py seek            # Swarm Seek
    python main.py guard           # Swarm Guard
    python main.py mind --port 9000
    python main.py mind --headless 300   # physics only, no browser, 300 simulated seconds (needs node)
    python main.py --voice               # [dan] also start the offline speech server: hold Space and say an order
    python main.py indoor --voice        # [dan] the indoor simulator (rooms, doors, line of sight) with orders by voice

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
SIMS = {"mind": "swarm-mind", "seek": "swarm-seek", "guard": "swarm-guard", "indoor": "swarm-indoor"}  # [dan] indoor


def start_voice(port: int):
    """[dan] Start voice/server.py (offline speech -> orders) with the voice venv if it exists."""
    venv = os.path.join(ROOT, "voice", ".venv", "Scripts" if os.name == "nt" else "bin", "python")
    py = venv if os.path.exists(venv) else sys.executable
    return subprocess.Popen([py, os.path.join(ROOT, "voice", "server.py"), "--port", str(port)])


def serve(sim: str, port: int, open_browser: bool, voice_port=None) -> None:
    voice = start_voice(voice_port) if voice_port else None  # [dan]
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
        finally:
            if voice:  # [dan]
                voice.terminate()


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
    p.add_argument("--voice", action="store_true", help="also start the offline speech server for push-to-talk orders (see voice/README.md)")
    p.add_argument("--voice-port", type=int, default=8765, help="speech server port (Swarm Mind connects to ws://localhost:8765)")
    a = p.parse_args()
    if a.headless is not None:
        sys.exit(headless(a.sim, a.headless))
    serve(a.sim, a.port, not a.no_browser, a.voice_port if a.voice else None)


if __name__ == "__main__":
    main()
