"""Reproducible baseline evaluation and optional PPO training."""
from dataclasses import asdict
from pathlib import Path
import json
import numpy as np
from .env import SwarmEnv
from .policy import FormationPolicy
from .world_model import WorldModel


def evaluate(config, seeds, output, policy=None, collect=False):
    policy = policy or FormationPolicy()
    folder = Path(output)
    folder.mkdir(parents=True, exist_ok=True)
    env = SwarmEnv(config)
    wm = WorldModel(1/config.control_hz, config.mass)
    reports, transitions = [], []
    for seed in seeds:
        obs, _ = env.reset(seed=int(seed))
        errors = []
        while True:
            action = policy(obs)
            before = env.dynamics_state()
            obs, reward, done, truncated, info = env.step(action)
            after = env.dynamics_state()
            # Contact discontinuities require a separate contact model.
            if not done:
                wm.update(before, env.last_action, after)
            if collect:
                transitions.append((before, action, after, done, truncated))
            errors.append(info["formation_error"])
            if done or truncated:
                reports.append(dict(seed=int(seed), mean_formation_error=float(np.mean(errors)), **info))
                print(json.dumps(reports[-1]), flush=True)
                break
    result = dict(config=asdict(config), episodes=reports, world_model=wm.metrics(),
                  survival_rate=float(np.mean([r["reason"] == "time_limit" for r in reports])))
    (folder/"evaluation.json").write_text(json.dumps(result, indent=2))
    if wm.weights is not None:
        wm.save(folder/"world_model.npz")
    if collect and transitions:
        np.savez_compressed(folder/"transitions.npz", state=np.array([t[0] for t in transitions]),
                            action=np.array([t[1] for t in transitions]), next_state=np.array([t[2] for t in transitions]),
                            terminated=np.array([t[3] for t in transitions]), truncated=np.array([t[4] for t in transitions]))
    env.close()
    return result


def train_ppo(config, steps, output, device, seed):
    try:
        import gymnasium as gym
        from gymnasium import spaces
        from stable_baselines3 import PPO
        from stable_baselines3.common.monitor import Monitor
    except ImportError as e:
        raise SystemExit("Install training extras first: python -m pip install -e '.[rl]'") from e

    class FlatAction(gym.ActionWrapper):
        def __init__(self, env):
            super().__init__(env)
            self.action_space = spaces.Box(-1, 1, (config.drones*3,), dtype=np.float32)
        def action(self, action):
            return action.reshape(config.drones, 3)

    folder = Path(output)
    folder.mkdir(parents=True, exist_ok=True)
    env = Monitor(FlatAction(gym.wrappers.FlattenObservation(SwarmEnv(config))), str(folder/"monitor.csv"))
    agent = PPO("MlpPolicy", env, seed=seed, device=device, verbose=1, n_steps=1024, batch_size=128,
                policy_kwargs=dict(net_arch=[256, 256]))
    agent.learn(total_timesteps=steps)
    agent.save(str(folder/"ppo"))
    (folder/"config.json").write_text(json.dumps(asdict(config), indent=2))
    env.close()
    evaluate(config, range(seed+10000, seed+10005), folder/"heldout",
             policy=lambda obs: agent.predict(obs.ravel(), deterministic=True)[0].reshape(config.drones, 3))
