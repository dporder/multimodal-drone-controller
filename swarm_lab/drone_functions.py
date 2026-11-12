"""Python drone controllers. The browser, not this module, integrates physics.

Coordinates are metres, Z up; quaternions are WXYZ. Camera payloads are RGB8.
Neural nets are online imitation learners, with bounded geometric fallback.
"""
import base64
import math
import numpy as np


def vector(value, length=3):
    out = np.asarray(value, dtype=float)
    if out.shape != (length,) or not np.all(np.isfinite(out)):
        raise ValueError(f"Expected {length} finite values")
    return out


def unit(value):
    return value / max(float(np.linalg.norm(value)), 1e-9)


class NeuralNetwork:
    def __init__(self, inputs, outputs, seed=7, hidden=24):
        self.inputs, self.outputs, self.hidden = inputs, outputs, hidden
        rng = np.random.default_rng(seed)
        self.w1 = rng.normal(0, .12, (hidden, inputs))
        self.w2 = np.zeros((outputs, hidden))
        self.b1, self.b2 = np.zeros(hidden), np.zeros(outputs)
        self.samples, self.mae = 0, None

    def forward(self, values):
        x = np.clip(vector(values, self.inputs), -4, 4)
        h = np.tanh(self.w1 @ x + self.b1)
        return x, h, self.w2 @ h + self.b2

    def predict(self, values):
        return self.forward(values)[2]

    def train(self, values, target):
        x, h, y = self.forward(values)
        error = np.clip(y - vector(target, self.outputs), -2, 2)
        hidden_error = (1 - h*h) * (error @ self.w2)
        self.w2 -= .025 * np.outer(error, h)
        self.b2 -= .025 * error
        self.w1 -= .025 * np.outer(hidden_error, x)
        self.b1 -= .025 * hidden_error
        mae = float(np.mean(np.abs(error)))
        self.mae = mae if self.mae is None else .98*self.mae + .02*mae
        self.samples += 1
        return y

    def metrics(self):
        return dict(architecture=f"{self.inputs} → {self.hidden} tanh → {self.outputs}",
                    samples=self.samples, mae=self.mae,
                    status="warming up" if self.samples < 100 else "online imitation",
                    trained_from="geometric / map controller")


def _camera(packet, index):
    frame = packet["frames"][index]
    if frame.get("encoding") != "rgb8-base64":
        raise ValueError("Camera must use rgb8-base64")
    if frame["pose"]["drone"] != index or abs(float(frame["pose"]["time"])-float(packet["time"])) > 1e-6:
        raise ValueError("Camera identity/time does not match observation")
    width, height = int(frame["width"]), int(frame["height"])
    if not 2 <= width <= 512 or not 2 <= height <= 512:
        raise ValueError("Invalid camera dimensions")
    raw = base64.b64decode(frame["data"], validate=True)
    if len(raw) != width*height*3:
        raise ValueError("Camera byte length mismatch")
    image = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
    # Actual RGB statistics enter the master MLP. Semantic localization is the
    # explicit simulator ray sensor; this is not a pretrained visual detector.
    cells = [image[y*height//2:(y+1)*height//2, x*width//2:(x+1)*width//2]
             for y in range(2) for x in range(2)]
    features = np.concatenate([c.mean(axis=(0, 1))/255 for c in cells])
    return dict(image=image, features=features, pose=frame["pose"], time=float(frame["pose"]["time"]))


def camera_master(packet):
    return _camera(packet, 0)


def camera_slave1(packet):
    return _camera(packet, 1)


def camera_slave2(packet):
    return _camera(packet, 2)


def intruder(packet):
    """Only communicated behavior and last sensor sighting, never hidden truth."""
    return packet["intruder"], packet.get("perception", {}).get("last_seen")


def intruder_acts(packet):
    return packet["intruder"]["intention"]


def environment(packet):
    return packet["environment"]


def goal(packet):
    return vector(packet["goal"])


def evaluate_trajectory(trajectory, t):
    """Analytic position, velocity and acceleration of a timed cubic Bezier."""
    controls = np.asarray(trajectory["control_points"], dtype=float)
    if controls.shape != (4, 3) or not np.all(np.isfinite(controls)):
        raise ValueError("Expected four finite XYZ control points")
    horizon = float(trajectory["horizon_seconds"])
    if not math.isfinite(horizon) or horizon <= 0:
        raise ValueError("Invalid trajectory horizon")
    u = float(np.clip(t/horizon, 0, 1)); v = 1-u
    p0, p1, p2, p3 = controls
    position = v**3*p0+3*v*v*u*p1+3*v*u*u*p2+u**3*p3
    velocity = (3*v*v*(p1-p0)+6*v*u*(p2-p1)+3*u*u*(p3-p2))/horizon
    acceleration = (6*v*(p2-2*p1+p0)+6*u*(p3-2*p2+p1))/horizon**2
    return dict(t=float(np.clip(t, 0, horizon)), position=position.tolist(),
                velocity=velocity.tolist(), acceleration=acceleration.tolist())


def curve_from_controls(controls, clear, fallback=True):
    controls = np.asarray(controls, dtype=float)
    curve = dict(kind="cubic", horizon_seconds=1., control_points=controls.tolist())
    def samples(c):
        # Vectorize all samples: Python replans three curves every 50 ms.
        u = np.linspace(0, 1, 21)[:, None]; v = 1-u
        a,b,d,e = np.asarray(c["control_points"])
        positions = v**3*a+3*v*v*u*b+3*v*u*u*d+u**3*e
        velocities = 3*v*v*(b-a)+6*v*u*(d-b)+3*u*u*(e-d)
        accelerations = 6*v*(d-2*b+a)+6*u*(e-2*d+b)
        return [dict(t=i*.05,position=p.tolist(),velocity=vel.tolist(),acceleration=acc.tolist())
                for i,(p,vel,acc) in enumerate(zip(positions,velocities,accelerations))]
    points = samples(curve)
    valid = lambda ps: all(clear(np.array(a["position"]), np.array(b["position"])) for a,b in zip(ps,ps[1:]))
    if fallback and not valid(points):
        p, end = controls[0], controls[-1]
        curve.update(kind="straight", control_points=[(p+(end-p)*t).tolist() for t in (0,1/3,2/3,1)])
        points = samples(curve)
    if fallback and not valid(points):
        curve.update(kind="hold", control_points=[controls[0].tolist() for _ in range(4)])
        points = samples(curve)
    for i, point in enumerate(points):
        point["delta_position"] = (np.asarray(points[min(i+1,20)]["position"])-point["position"]).tolist()
    curve.update(target=points[-1]["position"], points=points, sample_period_ms=50,
                 frame="world", representation="cubic_bezier", validated=bool(valid(points)))
    return curve


def local_curve(position, velocity, target, clear):
    p, v, target = vector(position), vector(velocity), vector(target)
    span = np.linalg.norm(target-p)
    return curve_from_controls([p, p+v*min(1/3, span/max(np.linalg.norm(v),.01)/3),
                                target-unit(target-p)*span/3, target], clear)


def master_reference_frame(trajectories, world_origin):
    """All three plans in one world-aligned frame fixed at episode start."""
    if len(trajectories) != 3 or [t["drone"] for t in trajectories] != [0,1,2]:
        raise ValueError("Expected master and two slave plans")
    origin = vector(world_origin)
    local = []
    for t in trajectories:
        local.append(dict(t, frame="mission_origin",
                          control_points=(np.asarray(t["control_points"])-origin).tolist(),
                          target=(vector(t["target"])-origin).tolist(),
                          points=[dict(p,position=(vector(p["position"])-origin).tolist()) for p in t["points"]]))
    return dict(name="mission_origin", origin_at="episode_start", world_origin=origin.tolist(),
                axes=np.eye(3).tolist(), axis_alignment="world", units="metres",
                generated_at=trajectories[0]["generated_at"], horizon_seconds=1,
                master_position=(vector(trajectories[0]["control_points"][0])-origin).tolist(), trajectories=local)


def neuralnetwork_tactics_from_master(network, contexts, cameras, clear, relative_coordinates):
    if len(contexts) != 3 or len(cameras) != 3:
        raise ValueError("Exactly three drone contexts and cameras required")
    inputs = np.concatenate([np.r_[(c["goal"]-c["position"])/10, c["velocity"]/4,
                                   c["speed"]/3, c["seen_age"]/10] for c in contexts] +
                            [c["features"] for c in cameras] + [contexts[0]["position"]/20] +
                            [vector(r["position"])/20 for r in relative_coordinates])
    controls = []
    for c in contexts:
        delta = c["goal"]-c["position"]
        desired = unit(delta)*min(.82*np.linalg.norm(delta), c["speed"])
        desired[2] = np.clip(desired[2], -1.5, 1.5)
        v0 = c["velocity"]
        change = desired-v0
        v1 = v0+unit(change)*min(np.linalg.norm(change), 2.5)
        end = c["position"]+.5*(v0+v1)
        controls.append(np.array([c["position"], c["position"]+v0/3, end-v1/3, end]))
    # The network predicts the entire curve: C1, C2, C3 for each of 3 drones.
    # C0 is the measured start position, so there are 3*3*3 = 27 outputs.
    teacher = np.concatenate([((cp[1:]-c["position"])/4).ravel() for cp,c in zip(controls,contexts)])
    prediction = network.predict(inputs)
    ready = network.samples >= 100 and network.mae < .06
    network.train(inputs, teacher)
    trajectories = []
    for i, (c, cp) in enumerate(zip(contexts, controls)):
        accepted = False
        if ready:
            proposed = cp.copy()
            proposed[1:] += np.clip((prediction[i*9:i*9+9].reshape(3,3)*4-(cp[1:]-c["position"] ))*.15, -.04, .04)
            # Anchor the start tangent to measured velocity, then validate the
            # remaining learned handles against the map, speed and acceleration.
            proposed[1] = cp[1]
            candidate = curve_from_controls(proposed, clear)
            feasible = all(np.linalg.norm(p["velocity"]) <= max(c["speed"],np.linalg.norm(c["velocity"]))+.4 and
                           np.linalg.norm(p["acceleration"]) <= 4 for p in candidate["points"])
            if candidate["kind"] == "cubic" and feasible:
                cp, accepted = proposed, True
        curve = curve_from_controls(cp, clear)
        curve.update(drone=i, neural_applied=accepted)
        trajectories.append(curve)
    return trajectories


RAYS = np.c_[np.cos(np.arange(12)*math.pi/6), np.sin(np.arange(12)*math.pi/6), np.zeros(12)]
ROTORS = np.array([[.19, .19], [-.19, .19], [-.19, -.19], [.19, -.19]])
SPINS = np.array([1, -1, 1, -1])


def rotation(q):
    q = vector(q, 4)
    if np.linalg.norm(q) < 1e-8:
        raise ValueError("Zero quaternion")
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])


def _rotors(network, drone, acceleration):
    R = rotation(drone["quaternion"])
    force = (vector(acceleration)+[0, 0, 9.81])*1.2
    z = unit(force)
    y = unit(np.cross(z, [1, 0, 0]))
    desired = np.column_stack([np.cross(y, z), y, z])
    skew = desired.T@R-R.T@desired
    error = np.array([skew[2, 1], skew[0, 2], skew[1, 0]])/2
    # Snapshot rates are already expressed in the body frame. Match the
    # simulated onboard controller; rotating these a second time is incorrect.
    omega = vector(drone["angular_velocity"])
    torque = -np.array([.65, .65, .35])*error-np.array([.14, .14, .12])*omega
    thrust = max(0., float(force@R[:, 2]))
    voltage = .85+.15*float(drone["battery"])
    teacher = np.clip((thrust/4+ROTORS[:, 1]*torque[0]/(4*.19**2)-ROTORS[:, 0]*torque[1]/(4*.19**2)+SPINS*torque[2]/(4*.018))/voltage**2, 0, 7)
    inputs = np.r_[thrust/28, torque/[.3, .3, .1], omega/5, drone["battery"]]
    prediction = np.clip(network.predict(inputs)*7, 0, 7)
    ready = network.samples >= 100 and network.mae < .025
    command = np.clip(teacher+(np.clip((prediction-teacher)*.1, -.025, .025) if ready else 0), 0, 7)
    network.train(inputs, teacher/7)
    return dict(command=command.tolist(),teacher_command=teacher.tolist(),residual=(command-teacher).tolist(),predicted_command=prediction.tolist(), blend=.1 if ready else 0., **network.metrics())


def neuralnetwork_rotor_master(network, drone, acceleration):
    return _rotors(network, drone, acceleration)


def neuralnetwork_rotor_slave1(network, drone, acceleration):
    return _rotors(network, drone, acceleration)


def neuralnetwork_rotor_slave2(network, drone, acceleration):
    return _rotors(network, drone, acceleration)


def _drone(index, observation, speed=1.8, trajectory=None):
    o = vector(observation, 32)
    reference = None
    if trajectory is not None:
        reference = evaluate_trajectory(trajectory, .25)
        # Track the timed interior of the curve, including its derivatives.
        # o[:3] is reference position minus current position, not terminal error.
        acc = (vector(reference["acceleration"])+.8*(o[:3]-o[3:6]*reference["t"])+
               2.2*(vector(reference["velocity"])-o[3:6]))
    else:
        desired = unit(o[:2])*min(speed, .82*np.linalg.norm(o[:2]))
        acc = np.r_[2.2*(desired-o[3:5]), 1.8*o[2]-2.2*o[5]]
    for r in range(12):
        distance = o[16+r]
        closing = o[3:6]@RAYS[r]
        repel = 1.8*max(0, 1/max(distance-.25, .15)-1/2.5)
        brake = 3*max(0, closing-math.sqrt(5*max(0, distance-.75)))
        acc -= (repel+brake)*RAYS[r]
    acc -= 2*o[12:15]/max(o[15], .15)*max(0, 1.8-o[15])
    return dict(id=index, acceleration=np.clip(acc, -4, 4), reference=reference)


def master_drone(observation, speed=1.8, trajectory=None):
    return _drone(0, observation, speed, trajectory)


def slave1_drone(observation, speed=1.8, trajectory=None):
    return _drone(1, observation, speed, trajectory)


def slave2_drone(observation, speed=1.8, trajectory=None):
    return _drone(2, observation, speed, trajectory)
