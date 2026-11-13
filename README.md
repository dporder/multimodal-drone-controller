# Multimodal drone controller (internal working title)

Our goal is to build the shortest path from human thought to coordinated drone actions in low/zero-connectivity, high-stakes environments.

This is a research science repo, currently exploring voice and brain signals as the bridge between human operators and tactical drone swarms.

We envision a future where a goal can be as simple as a quiet thought, and the swarm figures out the rest. From a spoken high-level strategy or a couple glances at a monitor, the ambition is to make these subtle intents actionable in the physical world, and to apply them in the most critical situations on earth where lives are at stake.

More to come soon.

## Run this branch with Python

Requires **Python 3.9+** and a browser with WebGL. No pip install, Node.js, npm,
build step, model download, or external CDN is needed for the current flight lab.

```sh
git clone --branch scale_swarm_from_one --single-branch https://github.com/dporder/multimodal-drone-controller.git
cd multimodal-drone-controller
python3 serve.py
```

Open **http://127.0.0.1:8766/**. On Windows, use `py serve.py`.
`python3 main.py flight` is an equivalent entry point. Stop with Ctrl-C.

For a server, container or another computer on your network:

```sh
python3 serve.py --host 0.0.0.0 --port 8766
```

Open `http://<server-address>:8766/`. Hosting platforms can use
`python3 serve.py --host 0.0.0.0` as the start command; the launcher reads their
`PORT` environment variable (8766 by default). It serves only the bundled
browser assets. The browser runs physics, drone behavior and the heuristic
controller; Python hosts the files. Optional external VLA adapters and the older
MuJoCo/hybrid experiments below have their own dependencies.

The page opens the complete environment with exactly three drones, three live
cameras, an equally sized shared-animation panel, vision cones and one-second
trajectory updates. Solo mode: `/browser/single/?drones=1`.

Python-only hosting checks:

```sh
python3 -S -m unittest discover -s tests -p test_static_server.py
```

## Swarm Flight Lab — three cameras, shared context and coordinated flight

Open **http://127.0.0.1:8766/browser/single/** after `python3 serve.py` for
the three-aircraft extension of Solo Lab. Three mounted cameras feed a partial
observed-surface reconstruction in a fixed frame. A heuristic master coordinates
search, localization and separate close views, generating three curved one-second
flight references every second. Twelve rotors move three physical bodies in one
browser-native Cannon ES world. No Python backend is needed for this lab.

Select an object visually and instruct find, inspect or gentle touch (master
only). The dashboard shows three live cameras, camera cones, absolute/relative
coordinates and a separate animated reconstruction with colored trajectory traces.
Hardware choices model compute mass/power and VLA memory budgets. NN1 fusion and
planning are heuristic; each aircraft retains the compact learned flight baseline.
Foundation VLA weights are not loaded. The original solo mode remains at
**http://127.0.0.1:8766/browser/single/?drones=1**.
See [usage and tests](swarm_lab/browser/single/README.md) and
[primary-source hardware/VLA research](http://127.0.0.1:8766/browser/single/research.html).

## Browser-native Swarm Lab

Run the three-drone simulation with **JavaScript physics and Python drone control**:

```sh
npm start
```

Open **http://127.0.0.1:8766/browser/**. The launcher serves the browser on port
8766 and starts/reuses the Python controller on 8767. JavaScript simulates gravity,
wind, obstacles, the independent person and quadcopter dynamics. Python receives
three camera frames and pose reports, then returns three local trajectories and
12 nominal rotor commands with bounded learned corrections every 50 ms of
simulation time. Onboard attitude feedback runs at 240 Hz inside JavaScript;
wall-clock camera and controller rates are measured separately. The left dashboard shows camera feeds,
local tactics, rotor thrusts, master absolute position and slave-relative reports.

The neural modules train online by imitating the geometric/map controller; the UI
shows warm-up and bounded learned contributions. They are not pretrained vision
models. Timing displays show actual measured camera and controller rates.

The shared world map uses the master's episode-start position as a fixed origin.
Choose **Known map · benchmark** or **Observed geometry only** in Drone feeds;
the latter plans from progressively observed surfaces without hidden obstacle
geometry. Ideal, nominal and stressed mapping sensors are available. Camera-FOV
visibility, physically continuous braking, joint trajectory clearance and atomic
control validation are covered by regression tests. See the
[engineering audit and remaining fidelity limits](swarm_lab/browser/README.md#engineering-audit-and-design-decisions).

The original **no-Python** mode is preserved at
**http://127.0.0.1:8766/browser/?controller=browser**; use `npm run start:static`
if you only want the static server. Exactly three drones are retained in both modes.

```sh
.venv/bin/python -m pytest -q
npm test
npm run test:hybrid
```

See [browser controls, architecture and testing](swarm_lab/browser/README.md).
The original Python/MuJoCo implementation and older demos remain available below.

## Run the earlier swarm simulators

Needs Python 3 and a browser. No install, no npm, no build.

```
git clone -b swarm-simulators https://github.com/dporder/multimodal-drone-controller
cd multimodal-drone-controller
python main.py
```

That serves the page on `http://127.0.0.1:8000` and opens Swarm Mind in your browser, the same file as the hosted artefact, pixel for pixel. On Windows use `py main.py` if `python` is not on the path. The page loads three.js from cdnjs the first time, so it needs internet once; everything else is inline.

Other entry points:

```
python main.py seek                  # Swarm Seek: camera-only search and zero-in
python main.py guard                 # Swarm Guard: decentralised task auction
python main.py mind --headless 300   # physics only in node, no browser, prints the outcome
```

What to do once it is open: press 1 to 4 for the goals, ← → to rotate the formation, click the ground to move the intruder yourself, Voice on to hear your commands. The Conversation panel narrates the loop, the Laws panel holds every equation with a live slider. Details in [`simulators/README.md`](simulators/README.md).

## Swarm Lab: physical world simulation

A separate MuJoCo simulator adds exactly three rigid-body quadrotors, real
contacts, independent rotor dynamics, wind, randomized parameters, range sensors,
an autonomous or manually controlled virtual person, and a visible destination. Its local 3D
viewer includes live telemetry and an optional learned trajectory predictor.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
python main.py lab
```

See [Swarm Lab setup, physical laws, controls and limitations](swarm_lab/README.md).
