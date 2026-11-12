"""Rigid-body swarm environment. High-level actions are desired world acceleration.

MuJoCo integrates position, quaternion, angular momentum and physical contacts.
A geometric attitude controller and four independently lagged motors realize each
acceleration command. No position/velocity teleportation is used during flight.
"""
from collections import deque
from dataclasses import asdict
import numpy as np
import gymnasium as gym
from gymnasium import spaces
import mujoco

from .config import Config
from .navigation import Person, Navigator
from .scene import build_xml, make_scene, MIXER_INV

RAYS = np.column_stack((np.cos(np.arange(12) * np.pi / 6), np.sin(np.arange(12) * np.pi / 6), np.zeros(12)))
OBS_SIZE = 32


def unit(v):
    return v / max(np.linalg.norm(v), 1e-9)


class SwarmEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, config=None):
        super().__init__()
        self.config = config or Config()
        self.n = self.config.drones
        self.dt = 1 / self.config.control_hz
        self.action_space = spaces.Box(-1, 1, (self.n, 3), np.float32)
        self.observation_space = spaces.Box(-np.inf, np.inf, (self.n, OBS_SIZE), np.float32)
        self.model = self.data = None
        self.finished = False

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        c, rng = self.config, self.np_random
        self.seed_value = seed
        self.obstacles = make_scene(c.scene, rng)
        self.masses = c.mass * (rng.uniform(.9, 1.1, self.n) if c.randomize else np.ones(self.n))
        inertia = rng.uniform(.9, 1.1, self.n) if c.randomize else np.ones(self.n)
        self.motor_tau = c.motor_tau * (rng.uniform(.8, 1.2, (self.n, 4)) if c.randomize else np.ones((self.n, 4)))
        self.drag = c.drag * (rng.uniform(.8, 1.2, (self.n, 1)) if c.randomize else np.ones((self.n, 1)))
        self.model = mujoco.MjModel.from_xml_string(build_xml(c, self.obstacles, self.masses, inertia))
        self.data = mujoco.MjData(self.model)
        self.body_ids = np.array([self.model.body(f"drone{i}").id for i in range(self.n)])
        self.geom_drone = {g: i for i, bid in enumerate(self.body_ids) for g in range(self.model.ngeom) if self.model.geom_bodyid[g] == bid}
        self.q = self.data.qpos.reshape(self.n, 7)
        self.v = self.data.qvel.reshape(self.n, 6)
        # Grid spacing is comfortably larger than the 0.55 m collision envelope.
        cols = min(4, self.n)
        self.offsets = np.array([[(i % cols - (cols-1)/2)*1.7, (i // cols)*1.7, 0] for i in range(self.n)], dtype=float)
        self.offsets[:, 1] -= self.offsets[:, 1].mean()
        self.q[:, :3] = self.offsets + [0, -3, 3.2]
        self.q[:, 3:] = [1, 0, 0, 0]
        self.goals = self.q[:, :3].copy()
        self.goal_velocity = np.zeros((self.n, 3))
        self.mode = "guidance"
        self.actor = Person(self.obstacles)
        self.person = self.actor.position
        self.destination = self.actor.destination
        self.actor.request_guidance(4.)
        self.air_nav = Navigator(self.obstacles, radius=.6, z=3.8)
        self.drone_routes = [[] for _ in range(self.n)]
        self.replan_at = 0.
        self.person_visible = [False]*3
        self.last_seen = None
        self.motor_speed = np.sqrt(np.repeat((self.masses * 9.81 / 4)[:, None], 4, axis=1) / 1.1e-5)
        self.forces = self.motor_speed**2 * 1.1e-5
        self.battery = rng.uniform(.9, 1, self.n) if c.randomize else np.ones(self.n)
        self.energy_wh = np.zeros(self.n)
        angle = rng.uniform(0, 2*np.pi)
        self.wind_base = c.wind * np.array([np.cos(angle), np.sin(angle), .03])
        self.wind_now = self.wind_base.copy()
        self.gust = np.zeros(3)
        self.last_action = np.zeros((self.n, 3))
        self.steps = self.collisions = 0
        self.hit = np.zeros(self.n, dtype=bool)
        self.finished = False
        self.history = deque([self.q[:, :3].copy()] * (c.radio_delay+1), maxlen=c.radio_delay+1)
        self.radio_positions = self.q[:, :3].copy()
        self.radio_drops = 0
        self.return_total = 0.
        mujoco.mj_forward(self.model, self.data)
        self._observe()
        return self.obs.copy(), self._info()

    def rotation(self):
        return self.data.xmat[self.body_ids].reshape(self.n, 3, 3)

    def set_goal(self, position):
        position = np.asarray(position, dtype=float)
        if position.shape != (3,) or not np.all(np.isfinite(position)):
            raise ValueError("goal must be three finite coordinates")
        position = np.clip(position, [-13, -13, 1], [13, 13, 6])
        self.goals = self.offsets + position
        self.goal_velocity[:] = 0
        self.mode = "hold"

    def _mission(self):
        if self.mode == "guidance":
            self.goal_velocity[:] = 0
            if self.actor.refused:
                # No pursuit or pressure following refusal; operator decides next.
                self.goals = self.q[:, :3].copy()
                self.mode = "hold"
            elif self.actor.intention == "leave via destination":
                if not any(self.person_visible):
                    self.goals = self.q[:, :3].copy()
                    return
                if self.data.time >= self.replan_at:
                    self.replan_at = self.data.time + 1.
                    delta = self.destination[:2] - self.person[:2]
                    direction = delta / max(np.linalg.norm(delta), 1e-6)
                    if np.linalg.norm(direction) < .1: direction = np.array([1., 0.])
                    lateral = np.array([-direction[1], direction[0]])
                    for i in range(self.n):
                        # All three indicate the same side of the route, leaving it open.
                        anchor = self.person[:2] + direction*(2+2.0*i) + lateral*3.5
                        if np.linalg.norm(delta) < 2:
                            anchor = self.destination[:2] + direction*(i-1)*1.8 + lateral*3.5
                        anchor = self.air_nav.nearest_clear(np.clip(anchor,-12,12))
                        self.drone_routes[i] = self.air_nav.path(self.q[i,:2], anchor)
                for i, route in enumerate(self.drone_routes):
                    if route:
                        if np.linalg.norm(self.q[i,:2]-route[0]) < .5 and len(route)>1:route.pop(0)
                        goal = np.r_[route[0],3.8]
                        # The route indicator is always kept outside the person's space.
                        away = goal[:2]-self.person[:2]
                        if np.linalg.norm(away) < 3:
                            goal[:2] = self.person[:2] + unit(np.r_[away,0])[:2]*3
                        self.goals[i] = goal
            return
        if self.mode == "formation":
            t = self.data.time
            center = [1.8*np.sin(.15*t), -3 + 1.8*np.sin(.10*t), 3.2 + .3*np.sin(.2*t)]
            self.goals = self.offsets + center
            self.goal_velocity[:] = [.27*np.cos(.15*t), .18*np.cos(.10*t), .06*np.cos(.2*t)]

    def _motors(self, acc):
        rotations = self.rotation()
        # Nominal mass belongs to the flight controller; randomized actual mass is hidden.
        force = self.config.mass * (acc + [0, 0, 9.81])
        for i, R in enumerate(rotations):
            z = unit(force[i])
            y = unit(np.cross(z, [1., 0., 0.]))
            desired = np.column_stack((np.cross(y, z), y, z))
            e = .5 * (desired.T @ R - R.T @ desired)
            error = np.array([e[2, 1], e[0, 2], e[1, 0]])
            omega = self.v[i, 3:]
            # Euler rigid-body dynamics, with gyroscopic feed-forward.
            inertia = self.model.body_inertia[self.body_ids[i]]
            torque = -np.array([.65, .65, .35])*error - np.array([.14, .14, .12])*omega + np.cross(omega, inertia*omega)
            thrust = max(0., force[i] @ R[:, 2])
            voltage = .85 + .15*self.battery[i]
            target = np.clip((MIXER_INV @ np.r_[thrust, torque])/voltage**2, 0, 7.0)
            target_speed = np.sqrt(target / 1.1e-5)
            self.motor_speed[i] += (target_speed-self.motor_speed[i]) * (1-np.exp(-1/self.config.physics_hz/self.motor_tau[i]))
        voltage = .85 + .15*self.battery[:, None]
        self.forces = 1.1e-5 * self.motor_speed**2 * voltage**2
        self.data.ctrl[:] = self.forces.ravel()

    def _external_forces(self):
        self.data.xfrc_applied[:] = 0
        relative = self.v[:, :3] - self.wind_now
        drag = -self.drag * relative * np.linalg.norm(relative, axis=1, keepdims=True)
        self.data.xfrc_applied[self.body_ids, :3] = drag
        # Bounded empirical downwash, deliberately not a CFD claim.
        if self.config.downwash:
            for i in range(self.n):
                d = self.q[i, :3] - self.q[:, :3]
                below = (d[:, 2] > .25) & (d[:, 2] < 4)
                attenuation = np.exp(-np.sum(d[:, :2]**2, axis=1)/.45) / (1+d[:, 2]**2)
                self.data.xfrc_applied[self.body_ids[below], 2] -= .12*self.forces[i].sum()*attenuation[below]
        self.data.xfrc_applied[self.body_ids, 3:] = -0.015 * np.einsum('nij,nj->ni', self.rotation(), self.v[:, 3:])

    def step(self, action):
        if self.model is None:
            raise RuntimeError("call reset() before step()")
        if self.finished:
            raise RuntimeError("episode ended; call reset()")
        action = np.asarray(action, dtype=float)
        if action.shape != (self.n, 3) or not np.all(np.isfinite(action)):
            raise ValueError(f"action must have shape {(self.n, 3)} and finite values")
        action = np.clip(action, -1, 1)
        # Last-resort separation from the person's collision capsule, in 3-D.
        # This changes only aircraft acceleration, never the person's behavior.
        desired = action*4
        for i in range(self.n):
            nearest = self.person.copy()
            nearest[2] += np.clip(self.q[i,2]-self.person[2], .28, self.actor.height-.28)
            away = self.q[i,:3]-nearest
            distance = np.linalg.norm(away)
            if distance < 1.8:
                direction = away/max(distance,1e-6)
                relative_speed = (self.v[i,:3]-self.actor.velocity)@direction
                minimum = max(0., 3.*(1.6-distance)-2.*relative_speed)
                current = desired[i]@direction
                if current < minimum:desired[i] += direction*(minimum-current)
        action = np.clip(desired/4,-1,1)
        c = self.config
        self.actor.step(self.dt, self.data.time+self.dt, self.np_random)
        self.person = self.actor.position
        self.data.mocap_pos[0] = self.person
        person_geom = self.model.geom('person_collision').id
        self.model.geom_size[person_geom,1] = self.actor.height/2-.28
        self.model.geom_pos[person_geom,2] = self.actor.height/2
        self.model.geom_rbound[person_geom] = self.actor.height/2
        # Ornstein-Uhlenbeck gusts at the control rate; seeded and dt-scaled.
        self.gust += -.7*self.gust*self.dt + self.np_random.normal(0, c.wind*.16, 3)*np.sqrt(self.dt)
        self.wind_now = self.wind_base + self.gust
        for _ in range(c.physics_hz // c.control_hz):
            self._motors(action * 4)
            self._external_forces()
            mujoco.mj_step(self.model, self.data)
            for j in range(self.data.ncon):
                contact = self.data.contact[j]
                for g in (contact.geom1, contact.geom2):
                    if int(g) in self.geom_drone:
                        self.hit[self.geom_drone[int(g)]] = True
            # Empirical electric-power model, 45 Wh pack, not battery chemistry.
            power = 10 + 10*np.sum(self.forces**1.5, axis=1)
            energy = power / c.physics_hz / 3600
            self.energy_wh += energy
            self.battery = np.maximum(0, self.battery - energy/45)
        mujoco.mj_forward(self.model, self.data)
        self.steps += 1
        self.collisions = int(self.hit.sum())
        self._mission()
        self.history.append(self.q[:, :3].copy())
        deliver = self.np_random.random(self.n) >= c.radio_loss
        self.radio_positions[deliver] = self.history[0][deliver]
        self.radio_drops += int((~deliver).sum())
        error = np.linalg.norm(self.goals-self.q[:, :3], axis=1)
        separation = self.separation()
        reward = float((2*np.exp(-error).mean() - .12*np.mean(action**2) - .08*np.mean((action-self.last_action)**2) - .3*np.mean(self.v[:, :3]**2)) * self.dt)
        self.last_action = action.copy()
        out = bool(np.any(np.abs(self.q[:, :2]) > 22) or np.any(self.q[:, 2] > 12) or np.any(self.q[:, 2] < 0))
        unstable = not np.all(np.isfinite(self.q)) or not np.all(np.isfinite(self.v))
        terminated = bool(self.collisions or out or unstable or np.any(self.battery <= 0))
        truncated = bool(self.steps >= round(c.seconds*c.control_hz) and not terminated)
        reason = "contact" if self.collisions else "bounds" if out else "unstable" if unstable else "battery" if np.any(self.battery<=0) else "time_limit" if truncated else "flying"
        if terminated:
            reward -= 20
        self.return_total += reward
        self.finished = terminated or truncated
        self._observe()
        info = self._info()
        info.update(reason=reason, min_separation=separation)
        return self.obs.copy(), reward, terminated, truncated, info

    def separation(self):
        if self.n < 2:
            return 99.0
        d = np.linalg.norm(self.q[:, None, :3]-self.q[None, :, :3], axis=-1)
        np.fill_diagonal(d, np.inf)
        return float(d.min())

    def _observe(self):
        rng, c = self.np_random, self.config
        positions = self.q[:, :3] + rng.normal(0, c.sensor_noise, (self.n, 3))
        velocities = self.v[:, :3] + rng.normal(0, c.sensor_noise*.5, (self.n, 3))
        self.ranges = np.full((self.n, 12), 12.)
        self.ray_hits = []
        neighbors, distances = np.zeros((self.n, 3)), np.full((self.n, 1), 12.)
        for i in range(self.n):
            relative = self.radio_positions - positions[i]
            d = np.linalg.norm(relative, axis=1)
            d[i] = np.inf
            if self.n > 1:
                j = np.argmin(d)
                neighbors[i], distances[i, 0] = relative[j], d[j]
            for k, direction in enumerate(RAYS):
                geom = np.array([-1], dtype=np.int32)
                distance = mujoco.mj_ray(self.model, self.data, self.q[i, :3], direction, None, 1, int(self.body_ids[i]), geom)
                if 0 <= distance < 12:
                    self.ranges[i, k] = distance
                    self.ray_hits.append((self.q[i, :3] + direction*distance).tolist())
        self.ranges = np.clip(self.ranges+rng.normal(0, c.sensor_noise, self.ranges.shape), 0, 12)
        self.person_visible = []
        for i in range(self.n):
            visible = False
            for height in [.3, .6, .9]:
                target = self.person + [0,0,self.actor.height*height]
                vector = target-self.q[i,:3]
                distance = np.linalg.norm(vector)
                if distance > 16:continue
                geom = np.array([-1],dtype=np.int32)
                hit = mujoco.mj_ray(self.model,self.data,self.q[i,:3],unit(vector),None,1,int(self.body_ids[i]),geom)
                if hit >= 0 and int(geom[0]) == self.model.geom('person_collision').id:
                    visible = True;break
            self.person_visible.append(visible)
        if any(self.person_visible):
            self.last_seen = dict(time=float(self.data.time),position=self.person.tolist())
        self.obs = np.column_stack((self.goals-positions, velocities-self.goal_velocity, self.rotation()[:, :, 2], self.v[:, 3:], neighbors, distances, self.ranges, self.battery, self.last_action)).astype(np.float32)

    def _info(self):
        return dict(time=float(self.data.time), formation_error=float(np.linalg.norm(self.goals-self.q[:, :3], axis=1).mean()),
                    collisions=self.collisions, energy_wh=float(self.energy_wh.sum()), return_total=self.return_total,
                    min_separation=self.separation(), radio_drops=self.radio_drops)

    def dynamics_state(self):
        """Privileged simulator state for dynamics identification, not policy observations."""
        return np.column_stack((self.v[:, :3], self.rotation()[:, :, 2], self.v[:, 3:], self.forces))

    def snapshot(self):
        return dict(config=asdict(self.config), obstacles=self.obstacles, time=float(self.data.time),
                    drones=[dict(id=i, position=self.q[i, :3].tolist(), quaternion=self.q[i, 3:].tolist(),
                                 velocity=self.v[i, :3].tolist(), angular_velocity=self.v[i, 3:].tolist(),
                                 motors=self.forces[i].tolist(), battery=float(self.battery[i]), hit=bool(self.hit[i]),
                                 goal=self.goals[i].tolist(), ranges=self.ranges[i].tolist()) for i in range(self.n)],
                    person=dict(**self.actor.snapshot(),observed_by=[i+1 for i,v in enumerate(self.person_visible) if v]),
                    perception=dict(visible=self.person_visible,last_seen=self.last_seen),
                    destination=self.destination.tolist(), wind=self.wind_now.tolist(), metrics=self._info(), finished=self.finished, mode=self.mode)
