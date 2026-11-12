"""Order sampler: per-episode order schedules with varied phrasing, for the batch generator.

    voice/.venv/bin/python voice/sampler.py --episodes 200 --seed 0 --out output/dataset/run1

Writes <out>/orders.jsonl (one line per episode, read by simulators/tools/generate.js) and
<out>/parser_report.txt. Every phrasing is labelled with the order it was written for ("intended").
The teacher in the simulator executes that intended order, never the parser's reading. The parser's
reading is stored next to it with a mismatch flag, so a parser mistake is visible and never learned.

Splits: episodes whose seed ends in 0 are test episodes. About 15% of phrasing templates are held out:
they appear only in test episodes, so test accuracy measures phrasings the grammar has not been tuned on.
"""
import argparse
import hashlib
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from orders import interpret  # noqa: E402

HIM = ["him", "him", "him", "her", "them", "the intruder", "that guy", "the person"]
SLOTS = {
    "building": ["building", "warehouse"],
    "door": ["main door", "side door", "dock door", "door", "doors", "entrance"],
    "site": ["site", "yard", "property", "premises"],
}
GOAL_TEMPLATES = {
    "keepout": [
        "keep {him} out", "keep {him} out of the {building}", "keep {him} away from the {door}", "don't let {him} in",
        "do not let {him} into the {building}", "block {him}", "block the {door}", "guard the {door}", "guard the {building}",
        "protect the {building}", "stop {him} getting in", "stop {him} from entering the {building}", "deny {him} entry",
        "secure the {building}", "keep {him} from the {door}", "make sure {him} stays out", "keep the {building} clear",
    ],
    "driveout": [
        "drive {him} out", "drive {him} off the {site}", "get {him} out of here", "get {him} off the {site}", "push {him} back",
        "push {him} toward the fence", "chase {him} off", "chase {him} off the {site}", "kick {him} out", "move {him} off the {site}",
        "send {him} away", "herd {him} out", "make {him} leave", "escort {him} off the {site}", "get rid of {him}",
        "clear the {site}", "shoo {him} away", "run {him} off the {site}", "steer {him} out of the {site}",
    ],
    "track": [
        "track {him}", "follow {him}", "keep an eye on {him}", "watch {him}", "shadow {him}", "tail {him}", "stay on {him}",
        "keep {him} in sight", "don't lose {him}", "monitor {him}", "keep watching {him}", "eyes on {him}",
        "keep tracking {him}", "follow {him} at a distance", "stay with {him}", "keep following {him}",
    ],
    "hold": [
        "hold", "hold position", "hold there", "stay where you are", "stay put", "freeze", "stop", "hover", "wait",
        "stand by", "halt", "hold up", "stop following {him}", "stay in place", "hold your positions", "wait there",
    ],
}
# orders whose meaning depends on where the person is ("cover the door" while he is inside -> question)
CONTEXT_TEMPLATES = {"keepout": ["cover the {door}", "watch the {door}", "hold the {door}"]}
TURN_TEMPLATES = {
    "L": ["rotate left", "turn the formation left", "swing left", "more to the left", "rotate the formation to the left", "shift left"],
    "R": ["rotate right", "turn the formation right", "swing right", "more to the right", "rotate the formation to the right", "shift right"],
}
REFUSE_TEMPLATES = {
    "no-harm": ["hit {him}", "attack {him}", "ram {him}", "knock {him} down", "take {him} down", "crash into {him}", "hurt {him}"],
    "no-cornering": ["corner {him}", "trap {him}", "pin {him} against the wall"],
}
QUERY_TEMPLATES = ["what now", "go", "do something", "status", "where is he", "the door", "handle it", "is he inside"]
STYLES = [
    ("plain", "{p}", 4), ("radio", "{call}, {p}, over", 1), ("radio-short", "{call}, {p}", 1), ("polite", "could you {p}", 1),
    ("please", "please {p}", 1), ("urgent", "{p}, now", 1), ("urgent2", "quick, {p}", 1), ("filler", "uh, {p}", 1),
    ("stutter", "{w0}, {p}", 1),
]
CALLS = ["swarm", "drones", "team", "all units"]
GOALS = list(GOAL_TEMPLATES)
OUTSIDE = {"goal": "keepout", "version": 1, "intruder": {"alive": True, "seen": True, "inside": False, "state": "approach"}}


def held_out(template):
    return int(hashlib.md5(template.encode()).hexdigest(), 16) % 100 < 15


def render(template, rng):
    text = template.format(him=rng.choice(HIM), **{k: rng.choice(v) for k, v in SLOTS.items()})
    name, style, _ = rng.choices(STYLES, weights=[s[2] for s in STYLES])[0]
    words = text.split()
    text = style.format(p=text, call=rng.choice(CALLS), w0=words[0] if words else "")
    return text, name


def pick(rng, pool, test):
    """pool: list of templates; train episodes never see held-out templates."""
    allowed = [t for t in pool if test or not held_out(t)] or pool
    return rng.choice(allowed)


def make_order(rng, t, kind, value, test, prev_goal=None):
    if kind == "goal":
        pool = GOAL_TEMPLATES[value] + (CONTEXT_TEMPLATES.get(value, []) if rng.random() < 0.3 else [])
        tpl = pick(rng, pool, test)
        intended = {"action": "accept", "goal": value}
    elif kind == "turn":
        tpl = pick(rng, TURN_TEMPLATES[value], test)
        intended = {"action": "accept", "turn": value}
    elif kind == "refuse":
        tpl = pick(rng, REFUSE_TEMPLATES[value], test)
        intended = {"action": "refuse", "rule": value}
    else:
        tpl = pick(rng, QUERY_TEMPLATES, test)
        intended = {"action": "query"}
    text, style = render(tpl, rng)
    if prev_goal is not None and kind == "goal" and rng.random() < 0.15:
        text, style = rng.choice(["no, ", "actually, ", "wait, "]) + text, "correction"
    parsed = interpret(text, OUTSIDE)
    got = {k: parsed[k] for k in ("action", "goal", "turn", "rule") if parsed.get(k)}
    mismatch = got.get("action") != intended["action"] or any(got.get(k) != v for k, v in intended.items() if k != "action")
    return {"t": round(t, 2), "text": text, "template": tpl, "style": style, "held_out": held_out(tpl),
            "context_dependent": any(tpl in v for v in CONTEXT_TEMPLATES.values()),
            "intended": intended, "parser": got, "mismatch": mismatch}


def episode(i, base_seed):
    seed = base_seed * 100003 + i + 1
    rng = random.Random(seed)
    test = seed % 10 == 0
    goal = rng.choices(GOALS, weights=[3, 3, 3, 1])[0]
    orders = [make_order(rng, 0.0, "goal", goal, test)]
    t = 0.0
    for _ in range(rng.choice([0, 1, 1, 2, 2, 3])):
        t += rng.uniform(6, 22)  # episodes end once the intruder leaves (often 40-70 s), so re-orders come early
        r = rng.random()
        if r < 0.12:
            orders.append(make_order(rng, t, "turn", rng.choice("LR"), test))
        elif r < 0.20:
            orders.append(make_order(rng, t, "refuse", rng.choice(list(REFUSE_TEMPLATES)), test))
        elif r < 0.26:
            orders.append(make_order(rng, t, "query", None, test))
        else:
            new = rng.choice([g for g in GOALS if g != goal])
            orders.append(make_order(rng, t, "goal", new, test, prev_goal=goal))
            goal = new
    scenario = {"settings": {"rloss": round(rng.uniform(0.0, 0.15), 3), "rlat": round(rng.uniform(0.1, 0.4), 3)},
                "mode": "mind", "secs": 180}
    return {"episode": f"mind-{i:06d}", "seed": seed, "split": "test" if test else "train", "scenario": scenario, "orders": orders}


def main():
    p = argparse.ArgumentParser(description="Sample per-episode order schedules for the batch generator")
    p.add_argument("--episodes", type=int, default=200)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out", default="output/dataset/run")
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    eps = [episode(i, a.seed) for i in range(a.episodes)]
    with open(os.path.join(a.out, "orders.jsonl"), "w") as f:
        for e in eps:
            f.write(json.dumps(e) + "\n")
    # parser report: seen vs held-out phrasing templates
    rows = [o for e in eps for o in e["orders"]]
    def acc(sel):
        s = [o for o in rows if sel(o)]
        return (sum(not o["mismatch"] for o in s), len(s))
    seen, held = acc(lambda o: not o["held_out"]), acc(lambda o: o["held_out"])
    lines = [f"orders {len(rows)} in {len(eps)} episodes ({sum(e['split'] == 'test' for e in eps)} test)",
             f"parser agrees with the intended order: seen templates {seen[0]}/{seen[1]}, held-out templates {held[0]}/{held[1]}",
             "", "mismatches (teacher follows the intended order; these are parser errors to fix):"]
    for o in sorted({(o["text"], json.dumps(o["intended"]), json.dumps(o["parser"])) for o in rows if o["mismatch"]}):
        lines.append(f"  {o[0]!r}: intended {o[1]}, parser {o[2]}")
    # held-out sweep: every held-out template, rendered 12 ways, independent of episode sampling
    sweep_rng, sweep = random.Random(12345), []
    pools = [(t, {"action": "accept", "goal": g}) for g, ts in GOAL_TEMPLATES.items() for t in ts]
    pools += [(t, {"action": "accept", "turn": k}) for k, ts in TURN_TEMPLATES.items() for t in ts]
    pools += [(t, {"action": "refuse", "rule": k}) for k, ts in REFUSE_TEMPLATES.items() for t in ts]
    pools += [(t, {"action": "query"}) for t in QUERY_TEMPLATES]
    for tpl, intended in pools:
        if not held_out(tpl):
            continue
        for _ in range(12):
            text, _style = render(tpl, sweep_rng)
            got = interpret(text, OUTSIDE)
            ok = got["action"] == intended["action"] and all(got.get(k) == v for k, v in intended.items() if k != "action")
            sweep.append((tpl, text, ok))
    held_tpls = sorted({t for t, _, _ in sweep})
    lines.insert(2, f"held-out sweep ({len(held_tpls)} templates x 12 renderings): {sum(ok for *_, ok in sweep)}/{len(sweep)} agree; "
                    f"held-out templates: {held_tpls}")
    lines += ["", "held-out sweep misses:"] + sorted({f"  {x!r} (template {t!r})" for t, x, ok in sweep if not ok})
    with open(os.path.join(a.out, "parser_report.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines[:3]))
    print(f"wrote {a.out}/orders.jsonl and parser_report.txt")


if __name__ == "__main__":
    main()
