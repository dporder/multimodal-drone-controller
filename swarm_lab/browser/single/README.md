# Swarm Flight Lab — three views, shared context and coordinated flight

From the repository root, run `python3 serve.py`, then open
**http://127.0.0.1:8766/**. Python 3.9+ is sufficient: no pip, npm or build step.
For network hosting use `python3 serve.py --host 0.0.0.0`; `--port` or the `PORT`
environment variable selects the port. On Windows use `py serve.py`.
`python3 main.py flight` and the existing `npm run start:static` also work.
All simulation and the default flight policy run in a browser worker; Python
only serves the bundled files. See the root README for clone/deployment commands.
The original city/yard swarm remains at `/browser/`. This lab now defaults to
**exactly three aircraft**. The original single-drone baseline is preserved at
`/browser/single/?drones=1`.

## Three-aircraft extension

- One Cannon ES world advances once at 240 Hz. Master, drone 2 and drone 3 each
  have their own rigid body, four motors, energy budget, camera and flight MLP.
  They collide with the environment and one another; they are never teleported
  along the displayed trajectories.
- The master heuristic coordinates `search → localize → separate close views`.
  `SEARCH_FIELDS` in `team.js` stores different survey corridors. Discovery
  requires camera FOV and first-hit occlusion checks. Shared sightings change the
  destination and camera aim; FOV narrows from 78° to 55° near the observed goal.
  Find confirms a shared sighting; inspect requires all three aircraft to settle
  at distinct viewpoints with the target visible. Only the master performs touch.
- **NN1 is an interface name, not a trained reconstruction network.** Its current
  implementation is heuristic semantic/depth fusion, route planning and cubic
  trajectory generation. It uses simulated RGB-D/semantic observations and exact
  simulator localization. It does not run an RGB detector or learned SLAM.
- Each camera has its own extrinsics and FOV. Other drones are rendered in that
  camera and participate in first-hit ray occlusion. The camera owner and all
  route/selection/cone annotations are excluded from raw RGB.
- The reconstruction accumulates only observed surface samples from a 24×14
  depth grid per camera at 20 Hz. Unseen faces are never filled with full meshes.
  Dim points indicate remembered surfaces. Moving drones are live telemetry poses,
  rather than permanent geometry in the map. This is a partial point-cloud scene,
  not a photorealistic reconstruction.
- The fixed frame starts at the master's initial position, with world-aligned
  XYZ axes and Z up. It never translates or rotates with the master. The dashboard
  shows all three absolute positions and their offsets from the master; exports
  also include the complete 3×3 pairwise relative-position matrix. Because the
  origin starts in flight, floor coordinates have negative Z in this frame.
- Every simulated second, the master generates three one-second cubic Bézier
  paths with 21 samples each, initial position/velocity, timestamp, revision and
  goal. The local learned velocity baseline supplies endpoint velocity; 20 Hz
  trajectory following supplies feedback plus feedforward to the 240 Hz rotor
  controllers. Static-geometry checks, timed inter-drone checks and a reciprocal
  separation supervisor can slow or stop execution. These are tracking references,
  not guarantees of exact future motion under wind and motor lag.
- The full simulation environment is always visible as the large main view,
  including each drone's translucent camera cone. Directly below, three camera
  feeds and the shared animation occupy four equal 16:9 panels (a 2×2 grid on
  narrow screens). Both world views render continuously; there is no tab switch.
  The animation retains three colored one-second trajectories refreshed every
  second. Its expand button opens a larger view; Escape restores the compact panel.
  Camera pixels never contain the cone or trajectory overlays.
- Controls, positions, hardware and telemetry are collapsed below the animation.
  Open **Controls** to choose an aircraft or change its camera. Teal / amber / blue
  identify master / drone 2 / drone 3. Cone previews extend 2.7 m for readability;
  sensor range remains 16 m, with object and aircraft occlusion.


Camera capture targets 20 Hz; actual display rate depends on GPU/browser load.
Physics and sensing use simulation time. Pausing freezes that time; single-step
advances all aircraft by 50 ms. Reset clears observations, recordings and plans.
The static server serves assets only; the default team needs no Python/backend.


## Use

1. Click a fixture in the overview or live onboard camera to capture its visual
   reference; alternatively choose its color/name.
2. Enter `Find the blue box`, `Inspect the orange panel`, or `Touch this object`.
   The local instruction parser recognizes find/inspect/touch and the four named
   fixtures. It is not an unrestricted language model.
3. Execute. The camera must actually observe the object before its position
   enters the agent's observation memory. Find confirms sight, inspect holds a
   stand-off, and touch approaches the fixture with a forward contact probe.
4. Choose the control aircraft, then its front/underslung mount, pitch/yaw/FOV
   and inspection light. Manual camera edits disable auto aim. Re-enable auto aim
   to let the master orient all three cameras toward an observed task object.
   Use Airframe view to inspect the actual camera mount, compute package, probe
   and four spinning rotors. Overview, Follow and Top are also available.
5. Hold (H), manual WASD + Q/E altitude + arrow yaw, pause (Space), single-step
   (50 ms), reset and JSON export are independent controls.

Touch approach speed is capped at 0.12 m/s. Success requires an actual Cannon
contact between the probe and selected fixture with closing speed ≤0.25 m/s.
Hull/rotor contact or contact with the wrong object stops the episode. After a
successful touch the drone holds slightly back from the fixture.

## Implementation and fidelity

- `team.js`: shared world, three independent agents, observed-map fusion, task
  fields, viewpoint allocation, cubic plans and separation supervision.
- `team-view.js`: camera cones, partial 3D surface map and animated trajectories.
- `simulation.js`: reusable single-aircraft controller with exactly one dynamic 6-DoF drone, four force application points,
  reaction torques, motor lag, gravity, drag, energy, camera FOV/ray observations,
  task transitions, geometric routing and manual/autonomous control. Body FLU
  is forward/left/up; world XYZ is Z up. State quaternions in UI snapshots use
  XYZW; external policy packets explicitly provide WXYZ.
- `policy.js` / `flight-policy.json`: a real 8 → 32 tanh → 3 MLP, 387 parameters,
  trained on 45,000 seeded synthetic examples. Inputs are relative waypoint XYZ,
  velocity XYZ, speed limit and precision-mode flag. Output is desired velocity.
  Geometric routing supplies waypoints; conventional 240 Hz stabilization mixes
  rotor thrusts. The dataset is synthetic behavioral cloning, not VLA pretraining.
- `worker.js`: owns physics at 240 Hz; renders get 20 Hz snapshots. Neural action
  inference has an adjustable simulated delay. Long/stale actions are discarded
  while physical stabilization continues. Hidden tabs suspend wall-clock stepping
  without a catch-up burst; this is a browser lifecycle behavior.
- `app.js`: local Three.js graphics, real 480×270 RGB render-to-texture, target
  selection and cropped reference, raw RGB export, scene controls and telemetry.
- `config.js`: explicit assumed flight profiles, manufacturer-based X650 payload
  limit, compute memory/power tiers, modeled installed masses and task parsing.
- `research.html`: linked primary-source hardware/model research, payload
  accounting, aerial-VLA precedents, missing capabilities and adapter contract.

The test bay's obstacle geometry is known to the navigation baseline. Target
position is supplied through a simulated semantic/depth detector only after
camera FOV/occlusion checks. There is no trained RGB detector, VIO/SLAM, foundation
VLA, force sensor or calibrated real-vehicle propulsion model. The rendered
fixture stands are decorative; task fixture boxes and bay obstacles are physical.
Compute-package masses, inertia, motor performance and power estimates are
illustrative, not validated digital twins or measured endurance predictions.

The hardware/model selectors change simulated installed mass and electrical load
and show memory estimates. They **do not download/load SmolVLA or OpenVLA**.
Default X650-class mass is 3.87 kg; default compute is Orin NX 16 GB at 25 W and an
assumed 450 g installed package. See the research page for official source links
and the separation between module specifications and integration assumptions.

## External VLA

In team mode the external adapter controls the **master only**; the two partners
continue using heuristic plans. External master actions override its local curve
reference. Select External drone-trained VLA, enter a CORS-enabled HTTP(S) endpoint, and
execute a mission. A synchronized request carries current PNG RGB, reference
crop, instruction, camera calibration/pose, ideal local vehicle state, ranges,
observed semantic objects and episode/mission/sequence/time. It excludes the
unobserved object list and full bay geometry.

Respond with:

```json
{"version":1,"episode":1,"mission":2,"sequence":3,
 "frame":"body_flu","velocity_mps":[0.2,0,0],
 "yaw_rate_rps":0,"duration_s":0.2}
```

Copy the identity fields from the request. Maximum speed is 1.5 m/s, yaw rate
1 rad/s, action duration 0.5 s, and response age 0.75 simulated seconds. The local
flight supervisor retains obstacle/range and gentle-contact constraints. A stale,
invalid or unavailable policy brakes instead of freezing physics. Foundation
policies trained on arm/gripper actions need a drone-trained action adapter;
those action dimensions cannot be sent directly as motor forces.

## Recordings and tests

Export saves up to 600 team records (1,000 in solo mode) at approximately
4 Hz, plus latest state, visual reference and current RGB. Team records contain
three synchronized camera images/poses, twelve rotor forces, absolute/relative
positions and all three local trajectory plans. Image pixels contain
no trajectory/bounding-box overlay. This is a JSON research format; conversion
is needed before using it as a LeRobot training dataset.

```sh
npm run test:team             # shared physics / mapping / planning / three-view tasks
npm run test:team-browser     # real three-camera dashboard / reconstruction / export
npm run test:python-browser   # same browser checks through dependency-free Python hosting
npm run train:single          # regenerate reproducible baseline weights
npm run test:single           # deterministic physics / task / contract tests
npm run test:single-browser   # real Chrome / WebGL / worker / camera / export
npm test                     # includes original swarm regressions
```

Tests verify single-drone invariants, force-driven hover, mass/power effects,
payload rejection, FOV/occlusion, all four gentle-contact tasks, distinct find and
inspect criteria, wrong-object contact, manual control, pause/step, delayed-policy
braking and external-action validation. Chrome tests exercise camera-based visual
selection, reference capture, mission completion, synchronized dataset export,
mount changes, payload warnings, adapter requests, disconnection and mobile layout.

The team regressions cover one-world integration, 12 independent motors, peer
visibility and occlusion, partial-only map samples, fixed-origin coordinates,
1 Hz trajectory updates that actually drive flight, search/reacquisition, all
four three-view inspections, gentle master contact, inter-drone separation,
manual control, pause/step, and stale-action braking. Browser tests verify three
distinct synchronized RGB images, other drones appearing in view, live partial
reconstruction, mission completion, recording export and responsive layout.
The original single-flight and city/yard swarm regression suites remain in
`npm test`; the original solo Chrome test explicitly uses `?drones=1`.

These tests establish simulator behavior, not real hardware performance or the
capability of a foundation VLA checkpoint. Known bay geometry is a navigation
prior. The partial reconstruction itself is never seeded with hidden meshes.
