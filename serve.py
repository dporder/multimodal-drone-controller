#!/usr/bin/env python3
"""Serve the browser-native flight lab using only Python's standard library.

    python3 serve.py
    python3 serve.py --host 0.0.0.0 --port 8766

Physics, agents, cameras and inference run in the browser, not in this server.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from typing import Optional, Sequence
from urllib.parse import unquote, urlsplit


ASSET_ROOT = Path(__file__).resolve().parent / "swarm_lab"
ENTRY_POINT = "/browser/single/"
PUBLIC_DIRECTORIES = {"browser", "web", "models"}


class FlightLabHandler(SimpleHTTPRequestHandler):
    """Expose static simulation assets, without source files or directory lists."""

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".glb": "model/gltf-binary",
        ".hdr": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_head(self):
        try:
            url = urlsplit(self.path)
            pathname = unquote(url.path, errors="strict")
        except (ValueError, UnicodeError):
            self.send_error(400, "Invalid URL")
            return None

        if pathname == "/":
            self.send_response(302)
            self.send_header("Location", ENTRY_POINT + ("?" + url.query if url.query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        # Validate both the URL and resolved file, including symlink targets.
        parts = pathname.lstrip("/").split("/")
        if (parts[0] not in PUBLIC_DIRECTORIES
                or any(part.startswith(".") for part in parts if part)
                or "\\" in pathname or "\0" in pathname):
            self.send_error(404, "Not found")
            return None
        try:
            root = Path(self.directory).resolve()
            relative = (root / pathname.lstrip("/")).resolve().relative_to(root)
            if (relative.parts[0] not in PUBLIC_DIRECTORIES
                    or any(part.startswith(".") for part in relative.parts)):
                raise ValueError("Outside public assets")
        except (ValueError, OSError, RuntimeError, IndexError):
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None


def create_server(host="127.0.0.1", port=8766, asset_root=ASSET_ROOT):
    handler = partial(FlightLabHandler, directory=str(Path(asset_root).resolve()))
    return ThreadingHTTPServer((host, port), handler)


def main(argv: Optional[Sequence[str]] = None):
    parser = argparse.ArgumentParser(description="Serve Swarm Flight Lab; no pip or npm install needed.")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"),
                        help="bind address (default: HOST or 127.0.0.1; use 0.0.0.0 for network access)")
    parser.add_argument("--port", type=int, default=os.environ.get("PORT", "8766"),
                        help="HTTP port (default: PORT or 8766)")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    if not (ASSET_ROOT / "browser/single/index.html").is_file():
        parser.error("simulation assets are missing; use a complete clone of this branch")
    try:
        server = create_server(args.host, args.port)
    except OSError as error:
        parser.exit(1, "Could not start server: {}\n".format(error))
    with server:
        host = "127.0.0.1" if args.host == "0.0.0.0" else args.host
        port = server.server_address[1]
        print("Swarm Flight Lab: http://{}:{}{}".format(host, port, ENTRY_POINT), flush=True)
        if args.host == "0.0.0.0":
            print("Network access: http://<server-address>:{}/".format(port), flush=True)
        print("Static Python host · browser physics · Ctrl-C to stop", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
