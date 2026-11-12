import argparse
from .config import Config


def main(argv=None):
    parser = argparse.ArgumentParser(description="Swarm Lab: rigid-body simulation, evaluation and training")
    parser.add_argument("mode", nargs="?", default="view", choices=["view", "evaluate", "train"])
    parser.add_argument("--scene", choices=["yard", "warehouse", "forest", "office"], default="yard")
    parser.add_argument("--wind", type=float, default=2)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--seconds", type=float, default=None)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-randomization", action="store_true")
    parser.add_argument("--episodes", type=int, default=5)
    parser.add_argument("--output", default="runs/swarm-lab")
    parser.add_argument("--collect", action="store_true")
    parser.add_argument("--steps", type=int, default=300000)
    parser.add_argument("--device", default="cpu", help="PPO device: cpu, cuda, or auto; MuJoCo physics runs on CPU")
    a = parser.parse_args(argv)
    if a.episodes < 1 or a.steps < 1:
        parser.error("episodes and steps must be positive")
    config = Config(scene=a.scene, wind=a.wind,
                    seconds=a.seconds if a.seconds is not None else (300 if a.mode == "view" else 30),
                    randomize=not a.no_randomization)
    if a.mode == "view":
        from .server import serve
        serve(config, a.seed, a.port, not a.no_browser)
    elif a.mode == "evaluate":
        from .train import evaluate
        evaluate(config, range(a.seed, a.seed+a.episodes), a.output, collect=a.collect)
    else:
        from .train import train_ppo
        train_ppo(config, a.steps, a.output, a.device, a.seed)


if __name__ == "__main__":
    main()
