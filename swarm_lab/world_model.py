"""Local, state-based dynamics ensemble: Newton prior + learned residuals.

This is a short-horizon system-identification model, not a visual foundation
model. Training uses privileged simulation states; the flight policy does not.
Evaluation is prequential: error is measured BEFORE adding that transition.
"""
from collections import deque
import numpy as np


class WorldModel:
    def __init__(self, dt=1/30, mass=1.2, members=5, seed=0):
        self.dt, self.mass, self.members = dt, mass, members
        self.rng = np.random.default_rng(seed)
        self.samples = deque(maxlen=6000)
        self.weights = None
        self.scale = np.array([4]*3 + [1]*3 + [3]*3 + [4]*4 + [1]*3, dtype=float)
        self.seen = 0
        self.errors = deque(maxlen=600)
        self.prior_errors = deque(maxlen=600)

    def prior(self, state):
        out = np.asarray(state, dtype=float).copy()
        thrust = state[:, 9:13].sum(axis=1, keepdims=True)
        out[:, :3] += self.dt*(state[:, 3:6]*thrust/self.mass - [0, 0, 9.81])
        return out

    def features(self, state, action):
        x = np.column_stack((state, action)) / self.scale
        return np.column_stack((x, np.ones(len(x))))

    def predict(self, state, action):
        prior = self.prior(state)
        if self.weights is None:
            return prior, np.full_like(prior, np.nan)
        preds = prior[None] + np.einsum('nf,mfk->mnk', self.features(state, action), self.weights)
        return preds.mean(axis=0), preds.std(axis=0)

    def update(self, state, action, next_state):
        predicted, _ = self.predict(state, action)
        prior = self.prior(state)
        if self.weights is not None:
            self.errors.extend(np.mean((predicted[:, :3]-next_state[:, :3])**2, axis=1).tolist())
            self.prior_errors.extend(np.mean((prior[:, :3]-next_state[:, :3])**2, axis=1).tolist())
        for x, y in zip(self.features(state, action), next_state-prior):
            self.samples.append((x.copy(), y.copy()))
        self.seen += len(state)
        if len(self.samples) >= 240 and self.seen % 120 < len(state):
            self.fit()

    def fit(self):
        x = np.array([s[0] for s in self.samples])
        y = np.array([s[1] for s in self.samples])
        weights = []
        for _ in range(self.members):
            idx = self.rng.integers(0, len(x), len(x))
            a, b = x[idx], y[idx]
            weights.append(np.linalg.solve(a.T@a + np.eye(x.shape[1])*.04, a.T@b))
        self.weights = np.array(weights)

    def rollout(self, positions, state, action, steps=15):
        if self.weights is None:
            return [], []
        s, p = state.copy(), positions.copy()
        paths, uncertainty = [p.tolist()], []
        for _ in range(steps):
            nxt, std = self.predict(s, action)
            # Contain extrapolation; predictions never alter actual simulation state.
            nxt[:, :3] = np.clip(nxt[:, :3], -15, 15)
            nxt[:, 3:6] /= np.maximum(np.linalg.norm(nxt[:, 3:6], axis=1, keepdims=True), 1e-6)
            nxt[:, 6:9] = np.clip(nxt[:, 6:9], -20, 20)
            nxt[:, 9:13] = np.clip(nxt[:, 9:13], 0, 8)
            p += .5*(s[:, :3]+nxt[:, :3])*self.dt
            s = nxt
            paths.append(p.tolist())
            uncertainty.append(np.linalg.norm(std[:, :3], axis=1).tolist())
        return paths, uncertainty

    def metrics(self):
        return dict(samples=self.seen, ready=self.weights is not None,
                    velocity_rmse=float(np.sqrt(np.mean(self.errors))) if self.errors else None,
                    prior_velocity_rmse=float(np.sqrt(np.mean(self.prior_errors))) if self.prior_errors else None,
                    horizon_seconds=15*self.dt, members=self.members)

    def save(self, path):
        if self.weights is None:
            raise ValueError("world model has not collected enough data")
        np.savez_compressed(path, weights=self.weights, scale=self.scale, dt=self.dt, mass=self.mass)

    @classmethod
    def load(cls, path):
        with np.load(path, allow_pickle=False) as f:
            model = cls(dt=float(f["dt"]), mass=float(f["mass"]), members=len(f["weights"]))
            model.weights, model.scale = f["weights"].copy(), f["scale"].copy()
        return model
