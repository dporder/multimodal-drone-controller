"""Local HTTP viewer. A single worker owns physics; requests take its lock."""
from dataclasses import replace
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import threading
import time
import webbrowser
from urllib.parse import urlparse

from .env import SwarmEnv
from .policy import FormationPolicy
from .world_model import WorldModel


class Lab:
    def __init__(self, config, seed):
        self.lock = threading.Lock()
        self.config, self.seed = config, seed
        self.running, self.stop = True, threading.Event()
        self.speed = 1.
        self.version = 0
        self.error = None
        self.reset()

    def reset(self):
        self.env = SwarmEnv(self.config)
        self.obs, _ = self.env.reset(seed=self.seed)
        self.policy = FormationPolicy()
        self.world_model = WorldModel(1/self.config.control_hz, self.config.mass, seed=self.seed)
        self.version += 1
        self.reason = "flying"
        self.error = None
        self.real_time_factor = 1.
        self.recording = []

    def step(self):
        action = self.policy(self.obs)
        state = self.env.dynamics_state()
        self.obs, _, done, truncated, info = self.env.step(action)
        if not done:
            self.world_model.update(state, self.env.last_action, self.env.dynamics_state())
        self.reason = info["reason"]
        if done or truncated:
            self.running = False

    def loop(self):
        while not self.stop.is_set():
            start = time.monotonic()
            try:
                with self.lock:
                    if self.running:
                        self.step()
                duration = time.monotonic()-start
                self.real_time_factor = min(self.speed, self.env.dt/max(duration, 1e-6))
                self.stop.wait(max(.001, self.env.dt/self.speed-duration))
            except Exception as exc:
                with self.lock:
                    self.error = str(exc)
                    self.running = False
                self.stop.wait(.1)

    def snapshot(self):
        with self.lock:
            snap = self.env.snapshot()
            paths, uncertainty = self.world_model.rollout(self.env.q[:, :3], self.env.dynamics_state(), self.env.last_action)
            snap.update(running=self.running, version=self.version, seed=self.seed, reason=self.reason,
                        error=self.error, real_time_factor=self.real_time_factor, speed=self.speed,
                        world_model=self.world_model.metrics(), predictions=paths, uncertainty=uncertainty, interventions=self.recording[-30:])
            return snap

    def command(self, command):
        with self.lock:
            name = command.get("command")
            if name == "pause":
                self.running = False
            elif name == "play":
                if self.env.finished:
                    self.reset()
                self.running = True
            elif name == "step":
                self.running = False
                if not self.env.finished:
                    self.step()
            elif name == "reset":
                proposed = replace(self.config, scene=command.get("scene", self.config.scene),
                                   drones=int(command.get("drones", self.config.drones)),
                                   wind=float(command.get("wind", self.config.wind)))
                seed = int(command.get("seed", self.seed))
                if seed < 0 or seed > 2**32-1:
                    raise ValueError("seed must be an unsigned 32-bit integer")
                self.config, self.seed = proposed, seed
                self.reset()
                self.running = True
            elif name == "goal":
                self.env.set_goal(command["position"])
            elif name == "actor":
                self.env.actor.command(command["action"],command.get("value"))
                if command["action"] != "input":
                    self.env.actor.events.append(dict(time=float(self.env.data.time),text="Operator selected "+command["action"]+"."))
                if command["action"] in ("manual","hide","autonomous"):
                    self.env.mode = "hold"
                    self.env.goals = self.env.q[:, :3].copy()
            elif name == "guidance":
                self.env.actor.request_guidance(self.env.data.time, float(command.get("compliance", .85)))
                self.env.mode = "guidance"
                self.env.replan_at = 0.
            elif name == "destination":
                import numpy as np
                p = np.asarray(command["position"], dtype=float)
                if p.shape != (3,) or not np.all(np.isfinite(p)) or not self.env.actor.navigator.clear(p):
                    raise ValueError("destination must be clear ground inside the site")
                self.env.actor.destination = np.r_[p[:2],0.]
                self.env.destination = self.env.actor.destination
                if self.env.actor.intention == "leave via destination":
                    self.env.actor.set_goal(p)
                self.env.replan_at = 0.
            elif name == "formation":
                self.env.mode = "formation"
            elif name == "speed":
                speed = float(command["value"])
                if speed not in (.25, .5, 1., 2.):
                    raise ValueError("unsupported playback speed")
                self.speed = speed
            elif name == "person":
                import numpy as np
                import mujoco
                position = np.asarray(command["position"], dtype=float)
                if position.shape != (3,) or not np.all(np.isfinite(position)):
                    raise ValueError("person position must have three finite coordinates")
                position = np.clip(position, [-13, -13, 0], [13, 13, 0])
                # Operator repositioning is an intervention, not autonomous behavior.
                for obstacle in self.env.obstacles:
                    p, size = np.array(obstacle["position"]), np.array(obstacle["size"])
                    if obstacle.get("ceiling"):
                        continue
                    if obstacle["kind"] == "box":
                        blocked = np.all(np.abs(position[:2]-p[:2]) < size[:2]/2+.4)
                    else:
                        blocked = np.linalg.norm(position[:2]-p[:2]) < size[0]+.4
                    if blocked:
                        raise ValueError("place the person on clear ground")
                if np.any(np.linalg.norm(self.env.q[:, :3]-(position+[0,0,.9]),axis=1)<1.2):
                    raise ValueError("place the person clear of aircraft")
                self.env.actor.position = position
                self.env.actor.velocity[:] = 0
                self.env.actor.set_goal(self.env.actor.goal)
                self.env.person = self.env.actor.position
                self.env.data.mocap_pos[0] = position
                mujoco.mj_forward(self.env.model, self.env.data)
            else:
                raise ValueError("unknown command")
            self.recording.append(dict(time=float(self.env.data.time), **command))


def serve(config, seed=7, port=8765, open_browser=True):
    lab = Lab(config, seed)
    root = Path(__file__).parent/"web"

    class Handler(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt, *args):
            pass

        def send_json(self, payload, status=200):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path == "/api/graph":
                from .knowledge import graph
                with lab.lock:
                    self.send_json(graph(lab.env))
            elif self.path == "/api/spec":
                from .knowledge import SPEC
                self.send_json(SPEC)
            elif self.path == "/api/state":
                self.send_json(lab.snapshot())
            else:
                super().do_GET()

        def do_POST(self):
            # Localhost only; block cross-origin websites from driving the sim.
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            if host not in (f"127.0.0.1:{port}", f"localhost:{port}") or (origin and urlparse(origin).netloc != host):
                return self.send_json({"error": "same-origin requests only"}, 403)
            if self.path != "/api/command":
                return self.send_json({"error": "not found"}, 404)
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    raise ValueError("invalid request size")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("command must be an object")
                lab.command(data)
                self.send_json({"ok": True})
            except (ValueError, TypeError, KeyError) as exc:
                self.send_json({"error": str(exc)}, 400)

    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(root)))
    worker = threading.Thread(target=lab.loop, daemon=True)
    worker.start()
    url = f"http://127.0.0.1:{port}"
    print(f"Swarm Lab • MuJoCo {config.physics_hz} Hz • {config.drones} drones\n{url}\nCtrl-C to stop.", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        lab.stop.set()
        worker.join(timeout=3)
        server.server_close()
