# Swarm Lab: JavaScript environment, Python drones

```sh
npm start
```

Open http://127.0.0.1:8766/browser/. The launcher starts/reuses a static Node server
on **8766** and a Python drone controller on **8767**. It uses `.venv/bin/python`
when available, or `SWARM_PYTHON` / `python3`. Install the existing Python package
first if needed: `python -m pip install -e .`. Node 20+ and a WebGL2 browser are
required. No bundler or additional JavaScript runtime dependency is needed.

The current default is **Python control with browser physics**. JavaScript owns
the world, independent person, visibility sensors, wind, gravity, contact and
Cannon rigid bodies. Python owns master tactics, three outer flight controllers,
and three separate four-output rotor networks. A simulated onboard attitude loop
closes rotor feedback in JavaScript at 240 Hz. Python never advances positions.

The earlier fully browser-native mode remains available at
http://127.0.0.1:8766/browser/?controller=browser. `npm run start:static` is enough
for that mode; it can continue offline after its local assets load. The Python
mode deliberately pauses physics if the controller is unavailable.

## Camera → Python → rotors → environment loop

Each accepted control exchange advances exactly **50 ms of simulation time**:

1. Three gimballed cameras render from the current rigid-body poses. The left
   dashboard displays 256×144 RGB images; Python receives 128×72 RGB8 copies.
   Gimbals aim at the last communicated sighting, extrapolate briefly, then scan.
   Before a first sighting they sweep the area. They never aim using a hidden
   person's true position. Walls/ceilings remain opaque in
   camera feeds even when the overview uses inspection cutaways.
2. The worker sends three camera frames, the master's absolute position, two
   timestamped relative slave reports, local drone measurements, the goal and
   selected map context to Python. Person localization requires a body sample
   inside the actual camera FOV and an unobstructed ray; an old sighting retains
   its timestamp. Hidden actor coordinates and drawn waypoints are excluded.
   Behavior/intent fields are explicitly communicated scenario metadata, not
   inferred human intent. Flight angular rates are body-frame radians/second;
   positions, velocities, accelerations and orientation are world-referenced.
3. Python's master selects reachable viewpoints and returns **three one-second
   local 3D cubic Bézier trajectories**, sampled at 21 points (every 50 ms). Each
   contains position, analytic velocity/acceleration, and next-step XYZ displacement. Cubic curves are checked against
   inflated 3D geometry, measured initial velocity, speed, acceleration and jerk.
   Joint reservations check pair separation between samples, including a bound
   for curve interpolation error. Invalid curves use finite-acceleration braking
   or a checked yielding maneuver; unresolved conflicts remain explicitly marked.
   A stationary fallback cannot falsely certify an instantaneous stop. The full
   future flight route is not shown: each new observation updates the local plan.
4. `master_drone`, `slave1_drone`, and `slave2_drone` compute independent flight
   commands by tracking the assigned curve at a 250 ms lookahead, using position
   and velocity error, acceleration feedforward and bounded disturbance trim.
   Their separate rotor networks return **3 × 4 nominal motor commands in N**
   and bounded learned residuals.
5. During twelve **240 Hz** substeps, each onboard attitude controller recomputes
   four commands from the new orientation and body rates, plus its Python
   network's bounded residual. Motor lag, rotor forces and moments, gravity,
   wind, drag and contacts produce the next positions. This keeps attitude
   feedback responsive between the slower Python trajectory updates.

The UI targets **20 Hz wall-clock capture and feedback** and reports measured
camera rate, control-loop rate, Python compute time and round-trip latency.
Physics waits for valid controls; slow hardware/transport slows simulation time
rather than skipping physics or silently substituting the browser controller.
Camera refreshes during that wait can show the same physical instant; 20 Hz
camera rendering does not imply 20 distinct closed-loop state transitions per
wall-clock second.
Only one request is in flight. Protocol 2 validates all three curves, their
analytic samples, twelve commands, residual bounds, frame, timestamp and validity
window before changing the actor, physics or world-model learner. Episode,
simulation-time and operator-command revisions reject superseded replies.
Duplicate requests return the cached result without training twice. Per-session
locks prevent concurrent learning on one episode without serializing every tab.
Background tabs suspend the loop. Pause, Step and reset remain explicit controls;
Python mode uses fixed 50 ms steps rather than playback speed multipliers.

The top-left **Drone feeds** dashboard shows all three images, three local
trajectories, twelve actual rotor thrusts (hover for requested commands), master
absolute position and delayed slave-relative coordinates. **Export latest 3
frames + controls** saves a JSON packet with PNG images, camera poses and control
telemetry. The **Shared world · fixed origin** plot uses one local mission frame:
`(0, 0, 0)` is the master's measured position at **episode start**, with world-aligned
X/Y and Z up. It does not follow the master, change with new plans, or reset when
the person gets a new route. Ground can have negative Z because the drone starts
above ground. A reset starts a fresh map. This local frame needs no Earth/GPS
coordinates; a future physical implementation would need pose estimation and
optionally a geographic anchor.

All three one-second trajectories, the moving drones, their trails, the assigned
bridge goal, camera frusta/images and remembered surfaces use this same frame.
Teal is master, amber is slave 1, blue is slave 2. Diamonds mark +1 s endpoints;
small dots mark 0.25 s intervals. Drag to orbit, right-drag to pan, scroll to zoom,
or use **Enlarge** / **Reset view**. The coordinate table shows the endpoints.

Mapping starts empty. A simulated depth/semantic camera samples first-hit
surfaces on a uniform 16×10 ray grid within each actual camera's FOV and range.
There are no object-targeted probes in normal operation; thin features can be
missed. Occluded / out-of-view objects do not enter
the observed map. Camera-coordinate depth hits are transformed through their
capture pose into the fixed mission frame and fused in 30 cm voxels. Multiple
drones' observations of the same simulator landmark merge into one object,
recording observer IDs, first/last sighting, partial bounds and surface samples.
Repeated voxel measurements use a running mean and variance, rather than last
write wins. Depth noise, camera-position noise and dropout have a separate seeded
random stream, so sensor queries never perturb physical gusts or person choices.
Objects persist when out of view. Sparse filled bounds are estimates of the
observed extent, not completed unseen building geometry. Mapping runs at up to
5 Hz simulation time; RGB capture still targets 20 Hz. The last 90 image keyframes
(one per drone per second) retain timestamps and poses and can be selected under
**Observed objects and saved camera views**.

This is a **simulated depth + semantic mapping pipeline**, not RGB-only SLAM or a
trained image detector. Depth uses collision geometry (not decorative foliage),
semantic IDs/labels and underlying drift-free localization come from the simulator.
The dashboard distinguishes **Known map · benchmark** (default) from
**Observed geometry only**. The latter excludes truth obstacles from packets and
the planner; it rebuilds navigation from partial observed bounds with uncertainty
inflation at most once per simulated second, caps speed at 0.8 m/s and brakes from
range measurements. Unknown space is not certified free. The known-map prior is
separate from the observed map; the three-layer graph retains landmark provenance.

Use **Apply & restart episode** to select the planning map and sensing profile.
URL equivalents are `?map=known&sensors=nominal&seed=7` or
`?map=observed&sensors=stress&seed=19`. Sensor profiles are:

| Profile | Depth noise σ | Mapping-position noise σ | Return dropout |
| --- | ---: | ---: | ---: |
| Ideal | 0 | 0 | 0% |
| Nominal (default) | 0.02 m | 0.015 m | 5% |
| Stress | 0.08 m | 0.06 m | 20% |

These affect depth mapping, not RGB rendering, flight-state estimates or the
semantic person detector. Pose noise here is independent measurement jitter,
not accumulated localization drift. Sparse-surface uncertainty is a heuristic,
not a calibrated probabilistic confidence interval.

Python returns `modules.master_frame` with immutable `world_origin`, identity
`axes`, and three translated `trajectories`. `reference_origin` and `observed_map`
travel with snapshots/control packets. Rotor tracking uses equivalent world-space
plans. Raw camera images remain unannotated. Export version 4 includes the map,
fixed frame, current images and pose-tagged saved image keyframes.
Closing the dashboard does not stop the Python cameras/control loop.

### Named Python interfaces

`swarm_lab/drone_functions.py` exposes:

- `camera_master`, `camera_slave1`, `camera_slave2`: decode and validate RGB frames.
- `master_drone`, `slave1_drone`, `slave2_drone`: separate local flight functions.
- `neuralnetwork_tactics_from_master`: one 69 → 24 tanh → 27 MLP for three cubic paths.
- `neuralnetwork_rotor_master`, `neuralnetwork_rotor_slave1`,
  `neuralnetwork_rotor_slave2`: separate 8 → 16 tanh → 4 MLPs / weights.
- `environment`, `intruder`, `intruder_acts`, `goal`: explicit input boundaries.

`swarm_lab/drone_backend.py` exposes `master(goal, relative_coordinates, cameras,
controller, packet)`, owns per-browser-session models, and provides the localhost
`POST /control` endpoint. `--stdio` provides the same JSON protocol for deterministic
cross-language integration tests. `controller_navigation.py` owns cached map
routing; it performs no physics integration.

### What the neural networks currently learn

These are real NumPy MLPs with online backpropagation, **not pretrained vision or
reinforcement-learning policies**. They imitate the map/geometric controller.
The master receives pose/goal features, relative coordinates, and four RGB cell
means from each actual image. Images affect network inference/training, but
semantic person localization still comes from the explicitly supplied ray
sensor. A pretrained image-only person detector has not been installed.

Model sizes (float64 weights and biases only; excludes Python/NumPy runtime):

| Network | Parameters | Weight storage | Raw network output |
| --- | ---: | ---: | --- |
| Master tactics, 69 → 24 → 27 | 2,355 | 18,840 bytes (18.4 KiB) | 27 normalized XYZ spline-handle offsets: C1/C2/C3 for each drone |
| Each rotor network, 8 → 16 → 4 | 212 | 1,696 bytes (1.7 KiB) | 4 normalized motor commands, scaled/clipped to 0–7 N |
| All four networks | 2,991 | 23,928 bytes (23.4 KiB) | 3 local trajectories and 12 motor commands after validation |

C0 is the measured position. The planner anchors C1 to measured velocity and
validates the learned handles against collision, speed and acceleration limits.
Each trajectory includes four XYZ `control_points`, `generated_at`,
`horizon_seconds: 1`, world frame, and 21 timed `points` with `position`, `velocity`,
`acceleration`, and `delta_position`. Curves are replanned at every accepted 50 ms
exchange; only the first control interval is executed before replanning. Rotor commands are voltage-compensated command values;
motor lag and battery voltage determine the actual thrust shown by the simulator.

Models begin in warm-up with geometric fallback. After 100 samples and sufficiently
low prediction error, master handle corrections are limited to 4 cm and revalidated;
rotor corrections are limited to 0.025 N per motor at a 10% blend. These residuals
augment the 240 Hz onboard geometric controller; twelve constant motor commands
are no longer held open-loop for an entire Python interval. The dashboard
reports sample counts and fallback/blend state. Models reset with a new episode.
The separate browser world-model ensemble continues to learn physical dynamics.

## Amsterdam canal block and drawn paths

The browser now opens a fictional **Amsterdam-inspired canal block**, using the
supplied photograph as a visual reference: canal-facing gabled houses, brick
quays, bridges and railings, trees, bicycles and moored boats. It is a stylized
interactive scene, not a photogrammetric reconstruction of a real address.
The four previous scenes remain in the environment selector; `?scene=yard`
opens the earlier default directly.

**Draw path** is enabled initially. The canal scene continuously guides toward
the marked **South-east bridge**. Drawing, hiding, climbing and declining an offer
do not cancel that drone mission. The person keeps their own movement controller.

After drawing, press **H** to use the next waypoint as the cover-search reference.
The person first reaches that waypoint, then moves to the nearest reachable
cover beside it and crouches. Without an assigned path, H uses the current
position. This differs from **Hide here** in the endpoint menu, which crouches
at the exact endpoint. H works immediately after a mouse drag because the canvas
receives keyboard focus.

Drag on the ground and release: the person
follows a collision-checked route from their current position through your
waypoints. Drawing again replaces the route, including after the person has
stopped at an exit or a previous endpoint. Straight mouse samples are simplified;
blocked intermediate samples are routed around, while invalid endpoints are
rejected. Select **Walk / Run** and an endpoint action before drawing:

- **Wait / hear offer:** finish the route, then hear an autonomous exit offer
  when visible to the drones.
- **Hide here:** crouch at the exact endpoint. Sensor rays determine whether
  the chosen spot actually conceals the person. A point behind a house can hide
  the actor; a point in the open cannot.
- **Jump:** perform a ballistic jump at arrival.
- **Climb nearby:** climb a reachable marked low table or courtyard crate.

The default gives your path priority. **May accept guidance early** allows the
person to consider an exit offer before finishing. The swarm plans from its
visible observations and indicates a collision-checked exit route; the person
retains their independent acceptance/refusal policy. Cyan shows the person's
route, gold the proposed exit. When visibility is lost, canal-scene drones continue indicating the bridge
route from the last observed position and search reachable viewpoints. They use
last observed velocity for a bounded motion estimate, never the hidden true
position. After reacquisition and at least six seconds at rest, a person in cover
can hear another offer. Refusals remain valid; repeat offers have a 15-second
cooldown. An accepted offer returns the actor to standing and follows the bridge
route. Drones do not see through houses or move the person by contact. The status card explains waiting, blocked approaches and
lost visibility.

The city has two non-walkable canals and four traversable footbridges. Its
1.2 m alleys fit the person but fail the city drone planner's 2.8 m clearance; aircraft
must find a wider detour or wait for clearance while their bridge mission remains active. Six physical 20 cm treads lead to a 1.2 m terrace.
The person automatically ascends/descends supported stair routes; arbitrary
terrace edges are not treated as stairs. Jumping uses the existing ballistic
controller. Buildings, trees, stairs, terrace, crate and low rail are colliders;
bicycles, boats, window trim and water ripples are decorative. Water is a walking
exclusion region, not a fluid simulation. The actor patrols independently in this
scene until assigned a path rather than immediately completing the exit scenario.

Use **Block** for the full neighborhood, **Top** for easier path drawing, or
**Orbit** to rotate/zoom (Orbit disables drawing). During a drag the camera and
simulation pause, and buildings fade to expose the route surface. Releasing a
valid route resumes movement. Camera cutaways never change sensor occlusion.

## Live decisions: one leader and two wings

Open **Decision tree** on the flight deck. The active branches, sensor belief,
three current orders, target coordinates, speed limits and transition history
update from the running worker. Click a node to inspect its rule. **Open full
graph** opens a larger live diagram; its view switch retains access to the
original Person / Swarm / Environment knowledge graph. The graph includes all
19 decision nodes, commander orders and `COORDINATES` / `ASSIGNS` relationships
inside the Swarm layer; it does not add a fourth layer.

The controller executes these branches:

1. **Track:** D1 leads the bridge route. D2 and D3 seek distinct viewpoints on
   opposite sides where geometry permits. Your drawn path and H take priority.
2. **Lose sight:** use the last sensor position, velocity and timestamp. Identify
   occluding cover from the known geometry. D1 targets an elevated viewpoint
   (8.2–10.2 m, depending on cover height); D2 and D3 receive different blind-spot
   assignments. Air routes detour around alleys that are too narrow.
3. **Search:** extrapolate up to four seconds / seven metres along clear walking
   ground. If still unseen after 12 seconds, expand the scan around that belief.
   There is no access to the actor's hidden position or drawn path in the flight
   route planner. Occlusion classification is an estimate from the last sighting.
4. **Reacquire:** share the actual new ray observation, reduce belief uncertainty,
   replan the bridge route and refresh all three orders.
5. **Offer / escort:** respect acceptance and refusal. On acceptance the leader
   marks the next turn and the wings maintain separate escort viewpoints. On
   refusal the actor keeps their behavior, while observation continues.
6. **Move:** normal target speed is 1.8 m/s. Clear, longer repositioning segments
   may request 3 m/s when forward range exceeds five metres. Range braking,
   person clearance, peer separation and facade clearance still constrain forces.
   Fast movement is repositioning toward an observation point, never a collision
   or a physical push. Aircraft use separate altitudes and retain motor dynamics.
7. **Arrive:** loiter around the bridge after the person arrives voluntarily.

The tactical decision graph is an explicit rule-based controller using an
observed world belief and map. The five-model learned dynamics predictor is
separate: it estimates flight motion, not human intent or tactics. Its error and
sample count appear beneath the tree. Tree trunks and buildings are physical
occluders; decorative foliage does not currently occlude rays.

## Other controls

- **Show panels** exposes environment, person, flight and telemetry controls.
- **Space** pauses/resumes, **Step** advances one 50 ms Python exchange (or one
  1/30-second browser-native control frame), **R** resets. Playback multipliers
  0.25×–2× apply only to browser-native mode.
  A terminal contact stops the episode; Play or Reset explicitly restarts it.
- Exactly **three drones** are created in every scene and reset.
- **Rebuild environment** applies yard, warehouse, forest or furnished-interior
  geometry, seed and wind. Reset repeats the same seed.
- **Manual** enables WASD/arrow keys for the person. Release to brake; Run/Walk
  changes speed, **J** jumps, **X** crouches, **H** seeks reachable cover, and **C**
  climbs a nearby annotated low table. Low-table climbing rises beside the edge
  before moving over the top. Walking off a surface returns to ground support.
- **Guide to exit** offers a route. The response menu selects acceptance,
  refusal or a seeded 85% acceptance probability. The default scenario offers
  guidance after four seconds. Manual control, cover, formation and hold cancel
  that scheduled offer. In the four original scenes, refusal alerts the operator and makes drones hold.
  The canal scene keeps its search and bridge mission active.
- **Place destination**, then click clear ground, changes the exit. **Alt-click**
  repositions the person as an explicit intervention. **Shift-click** chooses a
  reachable formation destination at the command altitude. Invalid placements
  report an error and leave the previous state intact.
- **Action** frames the agents and exit; Orbit allows dragging/zooming. Follow,
  Onboard, Top and Person views are also available. The camera never uses
  physical walls as a movement constraint. Ceilings are hidden and foreground
  objects fade when they obstruct agents. This changes only rendering: those
  objects still collide and occlude sensors. Contact geometry can be overlaid.
- **World graph** opens a live view of this simulation's three-layer graph in a
  new tab. Select/search nodes or export JSON. Each simulation tab has its own
  graph channel. Keep the simulation tab open. Background simulation tabs are
  suspended; returning resumes from the same time without catching up.
- **P** toggles predicted trajectories. **Export state** downloads true state,
  sensor observations, predictor metrics and the latest 30 operator commands.
  It is a snapshot, not a full replay archive.

## Browser architecture

`app.js` renders the local Three.js scene. `drone-dashboard.js` captures the three
cameras using one render atlas. `runtime.js` sends commands and camera packets to
`worker.js`, which serially owns all simulation state. In browser-only mode the worker advances a
fixed 30 Hz controller with eight 240 Hz physics substeps per control frame;
in Python mode, each valid response supplies acceleration references and bounded
neural motor residuals to twelve onboard-feedback substeps over 50 ms;
rendering is independent. Slow frames are bounded, so the simulation slows down
instead of taking large unstable timesteps or accumulating an unbounded backlog.

`sim/physics.js` uses the vendored **Cannon ES 0.20.0** engine. Each aircraft is a
dynamic six-degree-of-freedom rigid body with a hull, arms and rotor envelopes.
The controller computes attitude error and thrust, mixes them into four rotors,
integrates motor lag, then applies each rotor's force at its arm and its yaw
reaction torque. Cannon integrates position, orientation and contacts; the flight
controller never writes aircraft position or velocity. Drag, seeded gusts,
bounded empirical downwash, battery discharge, noisy local ranges, delayed radio
positions and random delivery loss are included. SI units, Z up, exported WXYZ
quaternions match the original implementation.

`sim/person.js` is a separate kinematic agent. Its own goal, acceleration-limited
motion, A* routes, posture, ballistic jump, cover choice and low-surface support
do not depend on drone proximity. Guidance response is a seeded Bernoulli choice.
The original scenes indicate one side of the route after acceptance; the canal
scene uses the leader and two-wing controller described above. Hidden actors do not
receive omniscient route tracking: in Python mode, head/torso/low-body samples must
pass camera FOV and ray-occlusion checks at a maximum 16 m, and the last observation
retains its timestamp. The older browser-native benchmark still uses omnidirectional
person ray visibility; its dashboard explicitly labels that distinction.
Waypoint approach speed is bounded and range-based braking accounts for closing
speed. The original-scene planner uses a person exclusion zone; it is not a collider.
City flight instead uses distinct reachable viewpoints and continuous clearance
constraints, so a large exclusion cylinder cannot seal the whole street. All delayed peer reports participate in lateral separation
to avoid pushing aircraft into indoor ceilings. An unavailable route captures a
fixed hold position. The clearance supervisors change only aircraft acceleration.

`sim/graph.js` projects the shared `models/world.json` ontology into Person,
Swarm and Environment layers with typed actions, affordances, laws, goals,
obstacles, all three drones and twelve rotors. The browser adapts the original
MuJoCo engine labels to Cannon ES without changing the Python specification.
`OBSERVES` and `LAST_OBSERVED` remain separate from true person state.

`sim/world-model.js` implements the five-member bootstrapped ridge ensemble from
the original world model: Newtonian prior plus learned transition residuals,
240 samples before fitting, refit every 120 samples, bounded 6,000-sample buffer,
and a 0.5-second rollout. Prediction errors are measured before each transition
is trained on; contact transitions are excluded. Predictor randomness uses a
separate seeded stream. Reading the graph or predictions does not alter physics.
Determinism is guaranteed for the same seed, commands and runtime, not numerical
equivalence with NumPy/MuJoCo or across different physics engines.

## Tests

```sh
.venv/bin/python -m pytest -q
npm test
npm run test:hybrid         # real Python control + JS physics, two 60 s episodes
npm run test:episodes       # full five-minute default episodes in all four scenes
```

The Node tests execute the same ES modules and Cannon engine as the browser.
They cover analytic free fall, hover, rotor torque, motor lag, contact stop,
quaternion normalization, A* clearance, manual movement, braking, jumping,
crouching, cover, climbing/dismount, acceptance/refusal, ray occlusion and stale
observations, command validation, graph structure, deterministic seeds, learned
forecasts, and 60-second guidance episodes in all four original scenes. City regressions
cover hidden-state invariance, leader ascent, distinct wing assignments, refusal,
reacquisition and an 80-second non-contact escort episode ending at the bridge.

For actual browser integration testing, install development-only dependencies:

```sh
npm install
npm start                   # keep running in one terminal
npm run test:browser         # uses installed Google Chrome, isolated/headless
npm run test:city            # browser-only drag, H, decision tree and bridge arrival
npm run test:dashboard       # Python loop, real RGB feeds, 12 rotors, disconnect pause
```

The browser test checks rendered WebGL and the real module worker, manual
keyboard controls, pause/step, acceptance/refusal, predictions, rebuilding an
environment, live graph inspection, canvas layout, downloads, offline execution,
console errors and absence of backend API requests. Screenshots go to the ignored
`test-results/` directory. `BROWSER_CHANNEL` and `SWARM_URL` can override Chrome
and the local URL.

## Engineering audit and design decisions

The strongest use of this system is an inspectable closed-loop research testbed.
Three distinctions are essential: simulator truth versus observations, planned
motion versus forces actually executed, and simulation time versus wall time.

| Gap found | Consequence | Implemented change |
| --- | --- | --- |
| Person ray detection ignored the camera FOV | A drone could localize someone outside its image | Python-mode detections now require both FOV and occlusion checks; aiming uses only last sightings |
| A growing observed map coexisted with an unlabelled complete prior | Apparent discovery could conceal privileged planning | Explicit known-map and observed-only modes; observed mode discards truth obstacles even if supplied |
| Depth sampling targeted known object positions | Narrow objects could be found using hidden scene knowledge | Uniform camera-ray sampling; noise/dropout and partial geometry are visible limitations |
| Voxel updates overwrote earlier measurements | No measurement aggregation or uncertainty | Running means/variance, observer provenance, age and partial bounds |
| 50 ms constant motor commands left attitude feedback open between updates | Gusts and changing attitude were corrected late | 240 Hz onboard attitude feedback, 20 Hz simulated-time outer control and bounded learned residuals |
| Ambiguous angular-rate frame | Double rotation corrupted damping and NN inputs | Body-frame rates are explicit and tested under a rotated attitude |
| A rejected curve could fall back to an instantaneous stationary hold | Nonphysical start velocity and false clearance claims | Measured-velocity continuity, derivative bounds, finite braking, explicit unresolved status |
| Each path was checked separately | Simultaneous curves could cross | Shared reservations with between-sample separation and cubic interpolation bounds |
| Cylinder checks omitted vertical end caps / aircraft size | Vertical approaches could pass collision checks incorrectly | Swept-body box/cylinder checks, end caps and 0.38 m inflation around the aircraft centre |
| An old reply could overwrite a newer operator intervention | Hold, route or pause commands could be superseded | Episode/time/command revisions and a 50 ms validity window |
| Incomplete response validation could mutate state before failure | Actor, physics and learning could diverge | Entire control contract checked before world mutation; invalid observations rejected before learning |
| Retry requests trained twice; every tab shared a global compute lock | Network faults changed learning; tabs blocked each other | Idempotent cached replies and per-session controller locks |
| Repeated geometry checks consumed most of a control period | Wall-clock feedback ran well below its target | Per-plan exact-segment cache, discarded whenever the plan/map changes |
| Sparse telemetry obscured these distinctions | A visually plausible scene could appear more capable than it was | Map/sensor selectors, actual control timing, short-step tracking error and unresolved-plan diagnostics |

The fixed `mission_origin` is a local metric map: initial master position,
world-aligned axes, metres, Z up. It does not need latitude/longitude. Camera
extrinsics convert camera-space depth into this frame; positions translate while
velocities/accelerations retain the same axis alignment. A future estimated
system should distinguish a stable map frame, continuous local odometry and each
body/camera frame, consistent with [ROS REP 105](https://github.com/ros-infrastructure/rep/blob/master/rep-0105.rst).

The control hierarchy is goal/behavior → three timed trajectories → acceleration
references → attitude/rate correction → motor mixing → physical forces. The
separation between trajectory and fast attitude feedback follows the cascaded
principle described in the [PX4 controller diagrams](https://docs.px4.io/main/en/flight_stack/controller_diagrams).
This is an implementation in this simulator, not a PX4 port or hardware validation.

Master output contains exactly three one-second cubic plans with identities,
generation time, frame, four control points, 21 samples of position/velocity/
acceleration/displacement, and per-plan feasibility/separation diagnostics.
The fast layer consumes bounded acceleration references and twelve learned motor
residuals; actual motor commands and thrusts are distinct telemetry. A plan is a
receding-horizon proposal: only its next 50 ms is executed before replanning.

The three-layer ontology remains Person / Swarm / Environment. Operator truth
can be inspected in that graph, but a graph display is not automatically a
controller input. Observation evidence carries source drone, frame, time and
partial geometry. The actor's private route and hidden current coordinates do
not enter tactics. Communicated intent still does; it must not be mistaken for
an inferred psychological state.

### Remaining boundaries and next research steps

1. **Perception and localization:** object identities, person classification and
   depth are simulated. Four RGB cell means per camera are weak appearance
   features, not visual scene understanding. The flight controller receives
   ideal local pose; mapping-position jitter is not visual-inertial odometry,
   drift, relocalization or loop closure. A genuine visual pipeline needs a
   detector/tracker, depth/stereo and estimated poses with calibrated uncertainty.
2. **Partial-world planning:** observed surfaces do not reveal unseen volume or
   certify free space. The observed-only mode is a cautious baseline, not complete
   exploration. An occupancy/free-space map with unknown cells, visibility-aware
   viewpoints and information-gain exploration should precede faster autonomous
   motion. Strategic routing remains a conservative 2.5D street grid, even though
   local trajectories and swept checks are 3D. No arbitrary rooftop/overflight
   route completeness is claimed.
3. **Environment fidelity:** trunks and walls collide/occlude; rendered tree
   foliage, bicycles and boats are decorative. The gimbal has ideal instantaneous
   aiming, with no angular-rate limit, blur, rolling shutter or exposure model.
   Sensor noise here is a reproducible baseline; [Gazebo's sensor library](https://gazebosim.org/libs/sensors/)
   provides a useful reference for richer RGB-D and noise modelling. Flight
   aerodynamics, downwash and battery parameters need calibration for any vehicle.
4. **Learning:** the master has 2,355 parameters; each rotor MLP has 212. They
   imitate a geometric teacher online. They are not pretrained visual policies,
   MPC solvers or reinforced autonomous tactics. Increasing model size alone
   would not fix missing perception or training data. Keep the bounded teacher
   baseline while collecting held-out scenario data and evaluating real learned
   policies for success, contacts, separation, tracking and latency.
5. **Distribution and time:** three named controllers have separate weights but
   share one Python process and a synchronized state packet. Relative reports
   are delayed, while each local controller still receives its current pose;
   this does not reproduce fully decentralized communications. Lockstep pauses
   the world when Python is unavailable. A real aircraft cannot pause gravity:
   it needs an onboard watchdog and loss-of-command behavior, as illustrated by
   [PX4 Offboard loss handling](https://docs.px4.io/v1.17/en/flight_modes/offboard).
   No hard 20 Hz wall-clock or real-flight failsafe guarantee is claimed.
6. **Safety and humans:** path checks are bounded model checks, not formal
   guarantees under tracking error, arbitrary disturbances or unknown obstacles.
   Unresolved reservations are reported; the controller brakes/avoids locally,
   and physical contact still terminates an episode. The person is an independent
   scripted agent with voluntary acceptance/refusal, not a predictive human model.
   There is no contact steering, coercive dive maneuver or automatic override of
   the person's route choice.

### Reproducing the audit

```sh
npm test
.venv/bin/python -m pytest -q
npm run test:hybrid
SWARM_STEPS=300 SWARM_MAP=observed npm run test:hybrid
SWARM_STEPS=300 SWARM_SEED=19 SWARM_SENSORS=stress npm run test:hybrid
npm run test:dashboard
```

The full hybrid test runs two 60-second episodes: independent patrol and a drawn
alley route ending in hiding, search, reacquisition, voluntary escort and bridge
arrival. Short configured episodes are stability checks, not proof of bridge
completion. The test intentionally resubmits each stale reply, so its rejected
counter equals its accepted counter. Normal live operation should not do that.
The dashboard's tracking RMS compares measured position with the **next 50 ms**
prediction; it is not a full one-second tracking error or localization accuracy.
Chrome integration additionally checks real RGB pixels, 3D plot controls, map
growth, saved image poses, exports, H/route interaction and disconnect pausing.

Audit results on this machine (11 November 2026):

| Check | Observed result |
| --- | --- |
| Node simulation regressions | 46 passed; changed contract/trajectory tests rerun after final edits |
| Python suite | 39 passed; two existing Gymnasium warnings about unbounded observation-space limits |
| Known-map hybrid, seed 7 | Both 60 s episodes remained contact-free; alley scenario completed search → reacquisition → escort → bridge |
| Known-map separation / compute | Minimum separation about 1.70 m; mean Python compute 25.2 ms patrol / 23.0 ms alley in headless integration |
| Observed-only hybrid, seed 7 | Two 15 s stability runs passed; minimum separation at least 1.63 m; no bridge-completion claim from these short runs |
| Stress sensing, seed 19 | Two 15 s runs passed without contact; minimum separation at least 1.64 m |
| Chrome complete interaction | Person reached bridge at 36.85 s simulated time; 22 mapped objects / 4,211 surface samples; RGB matched delivered pixels exactly; disconnect paused physics |
| Chrome observed-only mode | 19 observed objects / 2,353 surface samples, 30 saved keyframes; no truth-obstacle payload; fixed frame, plot interaction and export passed |

Chrome's final complete-run sample showed approximately 50 ms camera refresh,
42 ms Python compute and 115 ms between control requests. Those are distinct
measurements, not a hard real-time guarantee; host contention and rendering
change them. Short-step prediction RMS was roughly 1–2 mm in the headless runs,
which reflects the receding 50 ms prediction test, not real-world accuracy.

## Fidelity boundary and licenses

This is an engineering simulation, not a calibrated digital twin. Cannon ES and
MuJoCo have different contact solvers and integration details. Body mass/inertia,
drag and rotor constants remain illustrative. The actor is a scripted kinematic
capsule, not a biomechanical model or prediction of real human behavior. Climbing
is limited to annotated tables at most 1.1 m high. Door/window apertures are open;
furniture uses conservative solid colliders; foliage is visual only. A* with
local avoidance is a baseline and cannot guarantee collision-free flight for
arbitrary interventions, wind or seeds. The predictor uses privileged simulator
state and is descriptive; it never controls aircraft or provides a safety bound.

Cannon ES is MIT licensed: [bundled license](vendor/CANNON-ES-LICENSE.txt),
[upstream source](https://github.com/pmndrs/cannon-es).
Three.js and the original local image/model assets retain their
[existing credits](../web/assets/ATTRIBUTION.txt) and
[Three.js license](../web/vendor/THREE-LICENSE.txt).
