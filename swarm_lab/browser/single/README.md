# Solo Lab — one-drone visual flight simulator

Run `npm start`, then open **http://127.0.0.1:8766/browser/single/**.
The existing Node server serves this page. All simulation and the default flight
policy run in a separate browser worker; Python is not required for this page.
The original three-drone application remains at `/browser/`.

## Use

1. Click a fixture in the overview or live onboard camera to capture its visual
   reference; alternatively choose its color/name.
2. Enter `Find the blue box`, `Inspect the orange panel`, or `Touch this object`.
   The local instruction parser recognizes find/inspect/touch and the four named
   fixtures. It is not an unrestricted language model.
3. Execute. The camera must actually observe the object before its position
   enters the agent's observation memory. Find confirms sight, inspect holds a
   stand-off, and touch approaches the fixture with a forward contact probe.
4. Choose front/underslung camera mounts, pitch/yaw/FOV and inspection light.
   Use Airframe view to inspect the actual camera mount, compute package, probe
   and four spinning rotors. Overview, Follow and Top are also available.
5. Hold (H), manual WASD + Q/E altitude + arrow yaw, pause (Space), single-step
   (50 ms), reset and JSON export are independent controls.

Touch approach speed is capped at 0.12 m/s. Success requires an actual Cannon
contact between the probe and selected fixture with closing speed ≤0.25 m/s.
Hull/rotor contact or contact with the wrong object stops the episode. After a
successful touch the drone holds slightly back from the fixture.

## Implementation and fidelity

- `simulation.js`: exactly one dynamic 6-DoF drone, four force application points,
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

Select External drone-trained VLA, enter a CORS-enabled HTTP(S) endpoint, and
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

Export saves up to 1,000 synchronized RGB/state/action records at approximately
4 Hz, plus latest state, visual reference and current RGB. Image pixels contain
no trajectory/bounding-box overlay. This is a JSON research format; conversion
is needed before using it as a LeRobot training dataset.

```sh
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

Verified in the implementation session: all 60 JavaScript regressions passed
(14 for this simulator, 46 existing swarm regressions). Chrome completed visual
selection, find and gentle contact with no page errors; contact was approximately
0.006 m/s after 43 simulated seconds. The exported recording contained synchronized
RGB and four-rotor actions. A mock external VLA adapter exercised actual POST
requests and action handling, followed by disconnection with physics continuing.
Additional headless checks completed the orange-fixture touch at 4.62 kg and
5.42 kg total takeoff mass with 1.2 m/s wind, and the default profile at 2 m/s
wind. These tests establish simulator behavior, not performance of real hardware
or an actual foundation VLA checkpoint.
