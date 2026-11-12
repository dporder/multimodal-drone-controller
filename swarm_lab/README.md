# Swarm Lab

**Browser-native implementation:** run `npm start` from the repository root and
open http://127.0.0.1:8766/browser/. Physics, agents, knowledge graph and learned
predictor run in a browser worker with no Python backend. See the
[browser application guide](browser/README.md). The rest of this document
describes the preserved Python/MuJoCo implementation.

A local, three-aircraft simulation with MuJoCo rigid-body dynamics, a seeded
physical world, an autonomous or manually controlled virtual person, and a destination.
The existing Mind, Seek and Guard demos remain available.

## Run on this Mac

From the repository root:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[test]'
python main.py lab
```

Open http://127.0.0.1:8765. Python 3.9+ is supported. MuJoCo 3.3.7 is pinned to
the 3.3 release family for Apple Silicon/Python 3.9 wheel availability. Assets
and browser libraries are bundled; only initial dependency installation needs
internet. No GPU, Node installation or JavaScript build is needed for Swarm Lab.

```sh
python main.py lab --scene warehouse --wind 1 --seed 7
python main.py lab --scene forest --no-browser --port 8765
python main.py lab evaluate --episodes 5 --seconds 30 --collect --output runs/baseline
python -m pytest -q
```

Exactly three drones are enforced in configuration and all public entry points.
Start with the [world knowledge graph](http://127.0.0.1:8765/graph.html). It combines
`models/world.json` (the three-layer ontology, action contracts, object affordances,
physical laws and stochastic processes) with live instances of the person, three
aircraft, twelve motors and environment objects. Click a node to inspect properties
and relationships. `GET /api/spec` exposes the specification; `GET /api/graph`
returns the current graph. Person movement parameters are read from this spec.

The default **Action** camera frames the person, aircraft and exit together.
Panels start hidden; **Show panels** opens configuration and telemetry. Warehouse
and office perimeter walls render as cutaways but retain physical collisions.

Use **Rebuild environment** after changing scene, wind or seed. Space pauses;
R resets; P toggles predictions. Shift-click ground sets a formation destination.
The person initially chooses a site-inspection goal. Guidance is offered after
four seconds; acceptance is a seeded Bernoulli decision. Upon acceptance, drones
indicate one side of a route and the person independently navigates to the exit.
Refusal raises an operator alert and stops replanning toward the person. There is
no attack, isolation, cornering, blocking or proximity-induced compliance model.

The **Person & destination** controls provide:

- Autonomous / manual control; manual WASD or arrow-key movement.
- Walk, run, J jump, X crouch, H move to cover, C climb a nearby low table.
- Accept, ignore or stochastic response to a new guidance offer.
- Place destination: click the button, then click clear ground.
- Alt-click clear ground to reposition the person as an explicit intervention.

Walking/running follow collision-checked segments. Jumping integrates vertical
gravity and landing. Cover selects a reachable point adjacent to an occluder and
crouches on arrival; actual visibility still requires ray testing. Climbing is a
kinematic transition onto an annotated table at most 1.1 m tall, within 1 m reach.
It is not general wall, tree or window climbing. The actor has a capsule collider;
its height changes with posture. The animated visual asset is not a biomechanical
model. These manual capabilities are available to scenario tests; the default
autonomous policy chooses inspection or voluntary exit routing, not every possible
locomotion mode. Its behavior is an explicit state machine, not human intelligence.

Drone observations use a 16 m idealized gimballed sensor with head/torso/low-body
ray tests. Occlusion and last-observation time are recorded separately from true
person state. Route indication holds when the person is occluded; the simulation
does not grant omniscient tracking through walls. Map routing is A* using the known
site map; the local flight controller additionally uses noisy range measurements.

The world does not reset automatically on contact: the episode stops and reports
its termination reason. Press Play or Reset to start again. Export state downloads
a snapshot including the latest 30 operator interventions; it is not a complete
replay archive. Episodes last five minutes in the viewer by default.

## Explicit physical world model

The state consists of aircraft position, velocity, unit quaternion, body angular
velocity, four motor angular velocities, battery charge, person position, obstacle
geometry, goals, wind/gust state and radio history. SI units, right-handed **Z up**;
quaternions are **WXYZ**. This differs from the older demos' Y-up convention.

At 240 Hz, MuJoCo solves rigid-body dynamics and contacts:

- `m v_dot = R [0, 0, sum(f_i)] + F_drag + F_downwash - m g`
- `I omega_dot = tau - omega cross (I omega)`
- `f_i = k_f omega_i² * voltage_factor²`
- `omega_motor_dot = (omega_command - omega_motor) / motor_tau`
- `F_drag = -c_d |v - wind| (v - wind)`

Each rotor applies force at its own arm location plus a signed reaction torque.
A geometric attitude controller maps commanded acceleration into a rotation,
collective thrust and moments; the mixer then drives four motors. Rotor speed lag
uses the exact first-order exponential update at each physics step. Battery
voltage reduces available thrust; the controller compensates below saturation.
Positions and velocities are integrated by the physics engine, never teleported
by the flight controller. Drone contacts use a central box, capsule arms and
conservative spherical rotor envelopes.

The hierarchy is mission/formation waypoint → local position/velocity control
with measured obstacle and peer repulsion → desired acceleration → geometric
attitude control → rotor mixer → motor dynamics → physical motion. The local avoidance layer is a potential-field baseline following A* map waypoints: it can
get trapped or fail in narrow passages. It does not guarantee collision avoidance.

The simulator has three kinds of change:

1. **Deterministic physical evolution:** forces, rigid-body integration and contact
   response given a complete state and input sequence.
2. **Seeded uncertainty and stochastic events:** initial mass/inertia/motor/drag
   variation, Ornstein–Uhlenbeck gust innovations, Gaussian measurement noise and
   Bernoulli radio delivery. Random innovations happen during the episode as well
   as at reset. The same seed and same control/intervention sequence reproduce a
   run on the same software stack; changing only the seed changes these streams.
3. **Operator interventions:** pause/step, formation goals and person repositioning.
   These enter through the server's serialized command path and are timestamped.

Geometry for primary obstacles is shared by MuJoCo collision/ray queries and the
viewer. Forest foliage, container ribs, painted markings, a distant HDR background
and a decorative fence are visual detail. Only trunks are forest obstacles;
the fence is outside the central flight area and has no collision geometry.
Use **Contact geometry** to inspect primary obstacle colliders. A warehouse ceiling
is physically present at 8 m but visually hidden for inspection. The person is a kinematic capsule with standing/crouching height, not a biomechanical human simulation.

## Observations and learning interface

`SwarmEnv(Config())` implements Gymnasium's reset/step API. This is a centralized
swarm Gym environment, not a PettingZoo multi-agent environment. The baseline
policy shares the same local controller across three aircraft.

`action.shape == (3, 3)`: values in [-1, 1] command world-frame acceleration in
[-4, 4] m/s². The flight controller provides attitude stabilization. Raw rotor
control is available through the MuJoCo model for physics tests, but is not the
public learning action space.

Each 32-component observation row contains:

| Indices | Quantity |
| --- | --- |
| 0:3 | Goal minus noisy position, m |
| 3:6 | Noisy velocity minus commanded goal velocity, m/s |
| 6:9 | Body Z axis expressed in world coordinates |
| 9:12 | Body angular velocity, rad/s |
| 12:15 | Nearest received peer position minus noisy own position, m |
| 15 | Nearest received peer distance, m |
| 16:28 | Twelve horizontal ray ranges, clipped to 12 m |
| 28 | Battery charge fraction |
| 29:32 | Previous action |

Radio positions are delayed by two control steps and individually dropped with
probability 0.05 by default; a dropped update holds the last received state.
These are approximate sensors. Attitude and angular rate are privileged, while
position, velocity and range receive additive Gaussian noise. There is no camera,
GPS-denial estimator, IMU bias model, or visual odometry pipeline yet.

Reward integrates formation tracking, action effort/smoothness and speed costs;
physical contact, depleted battery or out-of-bounds flight terminates with a
penalty. Time limits truncate separately. Seeds, metrics and optional transition
datasets are written by `evaluate`.

## Optional learned predictor

The **physical world model** above is authoritative. A separate five-member,
bootstrapped ridge ensemble learns residual transitions on top of a Newtonian
prior. Inputs are privileged simulator velocity, body Z axis, body rates, actual
rotor forces and actions; outputs are next-state residuals. It fits after 240
samples, then every approximately 120 samples, with a bounded 6000-sample buffer.

Ghost trajectories cover 0.5 seconds with the current action held constant.
They do not drive the controller. Velocity error is measured before the observed
transition is added to training, then averaged over the latest 600 samples.
Ensemble disagreement is descriptive, not a calibrated safety guarantee.
Contact transitions are excluded. This model is not a vision-based foundation
model and does not replace physical laws or represent human intent.

## NVIDIA training later

```sh
python -m pip install -e '.[rl]'
python main.py lab train --device cuda --steps 300000 --output runs/ppo
```

Install a PyTorch build appropriate for the workstation's CUDA version first.
PPO inference/optimization can use CUDA; MuJoCo physics in this implementation
runs on CPU. Native massively parallel GPU simulation would require an MJX or
MuJoCo Warp backend. Optional PPO is supplied as an integration entry point;
policy convergence and CUDA execution are not validated on this Mac. Evaluation
uses held-out seeds offset by 10000 from the training seed.

## Fidelity and calibration

This is an engineering simulation with physically grounded motion and a textured
3D visualization. It is not a validated digital twin or photorealistic sensor
simulator. Calibrate mass, inertia, arm length, thrust/torque coefficients, motor
response, aerodynamic drag and contact geometry against a specific aircraft and
flight data before interpreting sim-to-real performance. Downwash and electrical
power are bounded empirical approximations, not CFD or battery electrochemistry.
Ground effect, propeller blade aerodynamics, detailed human biomechanics,
rolling-shutter cameras and terrain heightfields are not modeled. Human behavior
is a scripted decision model; there is no validated prediction of real people.
Doors/windows currently represent open apertures, not articulated closable panels.

Physics tests cover analytic free fall, static hover, rotor moments, quaternion
normalization, floor contact, motor lag, deterministic seeds, Gym API compliance,
range queries, formation episodes in all scenes and learned-model serialization.

References: [MuJoCo dynamics](https://mujoco.readthedocs.io/en/stable/computation/index.html),
[MuJoCo MJCF](https://mujoco.readthedocs.io/en/stable/XMLreference.html),
[Gymnasium API](https://gymnasium.farama.org/api/env/).
HDR lighting and asphalt maps are [Poly Haven CC0 assets](https://polyhaven.com/license);
see `web/assets/ATTRIBUTION.txt`. Three.js r170 is MIT licensed.


## Three-layer graph and fidelity boundary

The furnished-interior instance currently contains 83 nodes and 152 typed edges:
layer roots, agent and object types, action contracts, laws, live objects, the
person's own goal, three drone states, and all twelve rotors. Counts vary by scene.
The JSON separates true state from `OBSERVES` relations and a last-observation
memory; graph edges are semantic facts or affordances, not forces by themselves.
Physical forces are still evaluated by the simulator's equations.

The specification is a typed schema plus action contracts, not a general-purpose
reasoner or LLM planner. A* and explicit state machines implement its supported
navigation actions. The human model is deliberately approximate: its independent
autonomous intentions currently cover site inspection and voluntary exit routing;
manual controls expose the additional locomotion and cover capabilities. Open
doors and windows are apertures; closed-door articulation and glass physics are
not implemented. Sofa/table collisions use conservative boxes even though their
visual meshes are more detailed. Climbing supports annotated low tables, not
arbitrary walls, windows or trees. Detection is an idealized gimballed ray sensor,
not real computer vision. These limits are also visible in graph properties.
