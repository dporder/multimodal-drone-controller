# Swarm simulators

Three self-contained browser simulators of a 3-drone security swarm on the same site: a fenced yard with trees and containers, a warehouse with 3 doors, windows, a loading dock and a mezzanine reached by stairs. Each is one HTML file with no build step and no server. Open it in a browser, or run the physics headless in Node.

| Folder | What it tests | Position of the intruder |
|---|---|---|
| `swarm-guard/` | Decentralised task auction: 3 drones split search sectors and barrier slots with bids, no leader | Fed by a site camera |
| `swarm-seek/` | Search with onboard cameras only: belief map, altitude from uncertainty, zero-in after a sighting, indoor pursuit through doors | No feed, fence alarm only |
| `swarm-mind/` | Brain-steered swarm: master issues 3-D vectors, slaves run a quadrotor rotor controller on the vector they receive, elastic strings, surprise budget, narrated loop | Own mind, mouse, or random walk |

## Run

From the repo root, Python 3 only:

```
python main.py            # Swarm Mind, served on http://127.0.0.1:8000 and opened in your browser
python main.py seek       # Swarm Seek
python main.py guard      # Swarm Guard
python main.py mind --headless 300   # physics only, no browser, 300 simulated seconds (needs node)
```

Or open any `index.html` directly in a browser. The only external dependency is three.js r128 from cdnjs and Google Fonts; everything else is inline.

Headless smoke test of the physics, no browser needed:

```
node simulators/tests/headless.js            # all three, 150 simulated seconds each
node simulators/tests/headless.js mind 300   # one simulator, custom duration
```

## Swarm Mind, the brain-link bench

- **Goals** (buttons or keys 1 to 4): keep him out, drive him out, track him, hold. ← → rotate the formation by 15° per pulse.
- **Brain sources**: Keys (← → stand in for the 2 EEG classes), Sim BCI (classifier with accuracy p, decision interval Δt, latency ℓ), Log (paste or upload `t,cmd` lines), Live (websocket, works when the page is opened from a local file).
- **The loop**, every 0.5 s: your command → intruder mind → master template and 3 vectors → radio to the slaves (latency, loss) → rotor layer on each drone (thrust, roll, pitch, 4-rotor mixer). The Conversation panel narrates every step.
- **Laws panel**: every equation the simulator applies, with live sliders. Change a parameter mid-run and the outcome moves.
- **Sweep**: runs the headless sim over the surprise budget and plots time-in-view against it, for autopilot and simulated BCI.

`swarm-mind/src/build.py` assembles `index.html` from `src/core.html` (the physics, shared with the headless test) and the UI script. Edit the core there, run `python3 src/build.py`, open the result.

## Site frame

x to the east, z to the south, y up, metres. The site is 48 × 44 m. Building footprint x 6 to 42, z 3 to 19. Doors: main (24, 19), side (42, 11), dock (10, 19) at platform height 1.4 m. Belief cells are 2 m.
