"""Shared decentralized baseline; consumes only the noisy local observation."""
import numpy as np
from .env import RAYS


class FormationPolicy:
    def __init__(self, gains=None):
        self.gains = np.asarray(gains if gains is not None else [1.8, 2.2, 1.8, 2.0], dtype=float)

    def __call__(self, observation):
        o = np.asarray(observation)
        kp, kd, avoid, separate = self.gains
        acceleration = kp*o[:, :3] - kd*o[:, 3:6]
        # Range-based potential field. No obstacle positions or future states.
        ranges = o[:, 16:28]
        weight = np.maximum(0, 1/np.maximum(ranges-.25, .15) - 1/2.5)
        acceleration -= avoid * weight @ RAYS
        peer, distance = o[:, 12:15], np.maximum(o[:, 15:16], .15)
        acceleration -= separate * peer/distance * np.maximum(0, 1.8-distance)
        return np.clip(acceleration/4, -1, 1).astype(np.float32)
