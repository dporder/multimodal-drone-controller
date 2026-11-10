# Multimodal drone controller (internal working title)

Our goal is to build the shortest path from human thought to coordinated drone actions in low/zero-connectivity, high-stakes environments.

This is a research science repo, currently exploring voice and brain signals as the bridge between human operators and tactical drone swarms.

We envision a future where a goal can be as simple as a quiet thought, and the swarm figures out the rest. From a spoken high-level strategy or a couple glances at a monitor, the ambition is to make these subtle intents actionable in the physical world, and to apply them in the most critical situations on earth where lives are at stake.

More to come soon.

## Run the swarm simulators

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
