"""Python-only hosting checks: python3 -S -m unittest discover -s tests -p test_static_server.py."""
from contextlib import contextmanager
from http.client import HTTPConnection
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Thread
import unittest

from serve import ASSET_ROOT, create_server


@contextmanager
def running_server(root=ASSET_ROOT):
    server = create_server("127.0.0.1", 0, root)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def request(port, path, method="GET"):
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request(method, path)
        response = connection.getresponse()
        return response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
    finally:
        connection.close()


class StaticHostingTests(unittest.TestCase):
    def test_root_redirect_and_all_runtime_dependencies(self):
        with running_server() as port:
            status, headers, body = request(port, "/?drones=1")
            self.assertEqual(status, 302)
            self.assertEqual(headers["location"], "/browser/single/?drones=1")
            self.assertEqual(body, b"")
            for path, mime in [
                ("/browser/single/", "text/html"),
                ("/browser/single/style.css", "text/css"),
                ("/browser/single/app.js", "text/javascript"),
                ("/browser/single/worker.js", "text/javascript"),
                ("/browser/single/team.js", "text/javascript"),
                ("/browser/single/team-view.js", "text/javascript"),
                ("/browser/vendor/cannon-es.js", "text/javascript"),
                ("/web/vendor/three.module.js", "text/javascript"),
                ("/web/vendor/OrbitControls.js", "text/javascript"),
                ("/browser/sim/math.js", "text/javascript"),
                ("/browser/sim/observed-map.js", "text/javascript"),
                ("/browser/single/flight-policy.json", "application/json"),
            ]:
                with self.subTest(path=path):
                    status, headers, body = request(port, path)
                    self.assertEqual(status, 200)
                    self.assertTrue(headers["content-type"].startswith(mime))
                    self.assertEqual(headers["x-content-type-options"], "nosniff")
                    self.assertGreater(len(body), 0)
            weights = json.loads(request(port, "/browser/single/flight-policy.json")[2])
            self.assertEqual(weights["samples"], 45000)
            status, headers, body = request(port, "/browser/single/app.js", "HEAD")
            self.assertEqual(status, 200)
            self.assertGreater(int(headers["content-length"]), 0)
            self.assertEqual(body, b"")

    def test_non_assets_and_traversal_are_not_served(self):
        with running_server() as port:
            for path in [
                "/.git/config", "/README.md", "/drone_backend.py",
                "/browser/vendor/", "/browser/../../README.md",
                "/browser/%2e%2e/server.py", "/browser/%2f..%2fserver.py",
                "/browser/%00/app.js", "/browser/..%5cserver.py",
            ]:
                with self.subTest(path=path):
                    self.assertEqual(request(port, path)[0], 404)
            self.assertEqual(request(port, "/browser/single/", "POST")[0], 501)

    def test_symlinks_cannot_expose_private_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "browser").mkdir()
            (root / "private.txt").write_text("not public")
            (root / "browser/.env").write_text("not public either")
            try:
                (root / "browser/outside.txt").symlink_to(root / "private.txt")
                (root / "browser/hidden.txt").symlink_to(root / "browser/.env")
            except OSError as error:
                self.skipTest("Symlinks unavailable: {}".format(error))
            with running_server(root) as port:
                self.assertEqual(request(port, "/browser/outside.txt")[0], 404)
                self.assertEqual(request(port, "/browser/hidden.txt")[0], 404)

    def test_both_entry_points_work_without_site_packages(self):
        repository = Path(__file__).resolve().parents[1]
        for entry in [["serve.py"], ["main.py", "flight"]]:
            result = subprocess.run([sys.executable, "-S", *entry, "--help"],
                                    cwd=repository, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--host", result.stdout)
            self.assertIn("--port", result.stdout)


if __name__ == "__main__":
    unittest.main()
