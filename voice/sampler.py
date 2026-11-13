"""Order sampler: per-episode order schedules with varied phrasing, for the batch generator.

    voice/.venv/bin/python voice/sampler.py --episodes 200 --seed 0 --out output/dataset/run1
    voice/.venv/bin/python voice/sampler.py --sim indoor --episodes 500 --seed 0 --out output/dataset/indoor1

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


# ---------------------------------------------------------------------------------------------
# Indoor (simulators/swarm-indoor): scenarios with an intruder, a hiding intruder or a lost visitor,
# goals with room / door / exit slots, and context pairs ("get him out" depends on who it is).

ROOMS = ["lab", "office", "kitchen", "corridor", "lobby", "storage", "meeting room"]
PROTECTABLE = ["lab", "office", "kitchen", "storage", "meeting room"]
EXITS = ["main entrance", "east exit", "fire exit"]
EXIT_WORDS = {"main entrance": ["main entrance", "front door", "main door"], "east exit": ["east exit"], "fire exit": ["fire exit", "emergency exit"]}
ROOM_WORDS = {"lab": ["lab", "laboratory"], "office": ["office"], "kitchen": ["kitchen"], "corridor": ["corridor", "hallway"],
              "lobby": ["lobby", "reception"], "storage": ["storage room", "storeroom"], "meeting room": ["meeting room", "conference room"]}
THEM = ["them", "them", "her", "him", "the visitor", "the guest"]
I_TEMPLATES = {  # template -> params the order means (P = protected room, X = exit, R = room, D = door)
    "keepout": [("keep {him} out of the {P}", "P"), ("don't let {him} into the {P}", "P"), ("guard the {P}", "P"), ("protect the {P}", "P"),
                ("block the {P} door", "P"), ("secure the {P}", "P"), ("keep {him} away from the {P}", "P"), ("stop {him} getting into the {P}", "P"),
                ("keep {him} out", ""), ("hold the {P} door", "P"), ("deny {him} access to the {P}", "P"), ("make sure {him} stays out of the {P}", "P")],
    "driveout": [("drive {him} out", ""), ("drive {him} out the {X}", "X"), ("push {him} out of the building", ""), ("chase {him} out", ""),
                 ("make {him} leave", ""), ("herd {him} to the {X}", "X"), ("push {him} toward the {X}", "X"), ("move {him} out through the {X}", "X"),
                 ("drive {him} out of the building", ""), ("get rid of {him}", "")],
    "guideout": [("guide {them} out", ""), ("lead {them} to the {X}", "X"), ("show {them} the way out", ""), ("evacuate the visitor", ""),
                 ("guide {them} out by the {X}", "X"), ("take {them} to the {X}", "X"), ("escort the visitor out", ""), ("help {them} get out", ""),
                 ("lead {them} out of the building", "")],
    "track": [("track {him}", ""), ("follow {him}", ""), ("keep an eye on {him}", ""), ("watch {him}", ""), ("shadow {him}", ""), ("stay on {him}", ""),
              ("keep {him} in sight", ""), ("don't lose {him}", ""), ("keep eyes on {him}", ""), ("follow {him} through the building", "")],
    "contain": [("contain {him}", ""), ("surround {him}", ""), ("isolate {him}", ""), ("keep {him} inside that room", ""),
                ("don't let {him} out of that room", ""), ("hold {him} in there", ""), ("cordon {him} off", "")],
    "search": [("search the building", "L3"), ("find {him}", "L3"), ("look for {him}", "L3"), ("do a quick search", "L2"),
               ("have a quick look around", "L2"), ("quickly check the rooms", "L2"), ("search the building thoroughly", "L5"),
               ("search every corner", "L5"), ("do a thorough search", "L5"), ("sweep the floor", "L3"), ("clear the rooms", "L3")],
    "explore": [("map the floor", ""), ("map the building", ""), ("explore the building", ""), ("build a map", ""), ("survey the layout", ""),
                ("make a map of the floor", ""), ("scan the building", "")],
    "overwatch": [("watch the {X}", "XD"), ("cover the {X}", "XD"), ("monitor the {X}", "XD"), ("keep an eye on the {R}", "R"),
                  ("overwatch the {R}", "R"), ("watch the {R}", "R")],
    "return": [("come back", ""), ("return to base", ""), ("land", ""), ("come home", ""), ("return and land", ""), ("head back", ""),
               ("come back and land", ""), ("RTB", "")],
    "hold": [("hold", ""), ("hold position", ""), ("stay where you are", ""), ("stay put", ""), ("freeze", ""), ("stop", ""), ("hover", ""),
             ("wait", ""), ("stand by", ""), ("hold your positions", ""), ("stop following {him}", "")],
}
I_CONTEXT = {"out": [("get {him} out", ""), ("get {him} out of the building", ""), ("get {him} out through the {X}", "X")]}
I_REFUSE = {"no-harm": ["hit {him}", "attack {him}", "ram {him}", "knock {him} down", "crash into {him}", "take {him} out"],
            "no-cornering": ["corner {him}", "trap {him} in the {R}", "box {him} in", "pin {him} against the wall"]}
I_QUERY = ["what now", "status", "do something", "where is he", "handle it", "the door", "is he inside", "rotate left"]
DOORS_CTX = [{"name": n, "rooms": r} for n, r in [
    ("lab door", ["lab", "corridor"]), ("office door", ["office", "corridor"]), ("kitchen door", ["kitchen", "corridor"]),
    ("lab side door", ["lab", "office"]), ("lobby door", ["lobby", "corridor"]), ("storage door", ["storage", "corridor"]),
    ("meeting room door", ["meeting room", "corridor"]), ("main entrance", ["lobby", "outside"]), ("east exit", ["corridor", "outside"]),
    ("fire exit", ["kitchen", "outside"])]]


def indoor_context(role, protect):
    # what the parser may know when the order is sampled: the floor, who it is, not where he will be
    return {"sim": "swarm-indoor", "goal": "hold", "version": 1, "protected": protect, "rooms": ROOMS, "doors": DOORS_CTX,
            "person": {"role": role, "seen": True, "known": True, "room": None, "inside": True}}


def render_indoor(tpl, rng, role, protect):
    exit_ = rng.choice(EXITS)
    room = rng.choice(ROOMS)
    who = THEM if role == "visitor" else HIM
    vals = {"him": rng.choice(who), "them": rng.choice(THEM), "P": rng.choice(ROOM_WORDS[protect]) if protect in ROOM_WORDS else protect,
            "X": rng.choice(EXIT_WORDS[exit_]), "R": rng.choice(ROOM_WORDS[room])}
    text = tpl.format(**vals)
    if "{P} door" in tpl:  # door names use the plain room name ("storage door", not "storeroom door")
        text = tpl.format(**dict(vals, P="storage" if protect == "storage" else protect))
    name, style, _ = rng.choices(STYLES, weights=[s[2] for s in STYLES])[0]
    words = text.split()
    text = style.format(p=text, call=rng.choice(CALLS), w0=words[0] if words else "")
    return text, name, {"exit": exit_, "room": room}


def make_indoor_order(rng, t, kind, value, test, role, protect, prev_goal=None, then=None, pool_override=None):
    ctx = indoor_context(role, protect)
    if kind == "goal":
        pool = pool_override or I_TEMPLATES[value]
        tpl, slot = pick_pair(rng, pool, test)
        intended = {"action": "accept", "goal": value}
    elif kind == "context":
        tpl, slot = pick_pair(rng, I_CONTEXT["out"], test)
        value = "guideout" if role == "visitor" else "driveout"
        intended = {"action": "accept", "goal": value}
    elif kind == "refuse":
        tpl, slot = pick(rng, I_REFUSE[value], test), ""
        intended = {"action": "refuse", "rule": value}
    else:
        tpl, slot = pick(rng, I_QUERY, test), ""
        intended = {"action": "query"}
    text, style, chosen = render_indoor(tpl, rng, role, protect)
    params = {}
    if slot == "P":
        params["room"] = protect
    elif slot == "X":
        params["exit"] = chosen["exit"]
    elif slot == "XD":
        params["door"] = chosen["exit"]
    elif slot == "R":
        params["room"] = chosen["room"]
    elif slot.startswith("L"):
        params["level"] = int(slot[1:])
    if intended["action"] == "accept":
        intended["params"] = params
    if then is not None and kind in ("goal", "context"):
        ttpl, tslot = pick_pair(rng, I_TEMPLATES[then], test)
        ttext, _, tch = render_indoor(ttpl, rng, role, protect)
        tparams = {"P": {"room": protect}, "X": {"exit": tch["exit"]}, "XD": {"door": tch["exit"]}, "R": {"room": tch["room"]}}.get(tslot, {})
        if tslot.startswith("L"):
            tparams = {"level": int(tslot[1:])}
        text = (text[:-len(", over")] if text.endswith(", over") else text) + rng.choice([", then ", " and then ", ", after that "]) + \
            (ttext[:-len(", over")] if ttext.endswith(", over") else ttext)
        intended.update({"queued": then, "queued_params": tparams})
        tpl = tpl + " + then " + ttpl
    if prev_goal is not None and kind == "goal" and rng.random() < 0.15:
        text, style = rng.choice(["no, ", "actually, ", "wait, "]) + text, "correction"
    parsed = interpret(text, ctx)
    got = {k: parsed[k] for k in ("action", "goal", "rule", "params", "queued") if parsed.get(k) not in (None, {})}
    mismatch = got.get("action") != intended["action"] or got.get("goal") != intended.get("goal") or got.get("rule") != intended.get("rule") \
        or (intended["action"] == "accept" and any(got.get("params", {}).get(k) != v for k, v in intended.get("params", {}).items())) \
        or got.get("queued") != intended.get("queued")
    return {"t": round(t, 2), "text": text, "template": tpl, "style": style, "held_out": held_out(tpl),
            "context_dependent": kind == "context", "intended": intended, "parser": got, "mismatch": bool(mismatch)}


def pick_pair(rng, pool, test):
    allowed = [x for x in pool if test or not held_out(x[0])] or pool
    return rng.choice(allowed)


# first goal and follow-up goals by scenario (weights): an intruder heading for a room, an intruder hiding, a lost visitor
I_FIRST = {"enter": {"keepout": 5, "driveout": 2, "track": 2, "contain": 1, "overwatch": 1, "hold": 1, "context": 1},
           "hide": {"search": 6, "explore": 1, "overwatch": 1, "hold": 1},
           "visitor": {"guideout": 5, "search": 2, "track": 1, "hold": 1, "context": 1}}
I_NEXT = {"enter": {"keepout": 2, "driveout": 3, "track": 3, "contain": 2, "overwatch": 1, "hold": 1, "return": 1, "search": 1},
          "hide": {"search": 2, "track": 3, "contain": 2, "driveout": 2, "overwatch": 1, "hold": 1, "return": 1, "explore": 1},
          "visitor": {"guideout": 3, "track": 1, "hold": 1, "return": 2, "explore": 1, "search": 1}}


def wchoice(rng, table, exclude=None):
    items = [(k, w) for k, w in table.items() if k != exclude]
    return rng.choices([k for k, _ in items], weights=[w for _, w in items])[0]


def indoor_episode(i, base_seed):
    seed = base_seed * 100003 + i + 1
    rng = random.Random(seed)
    test = seed % 10 == 0
    kind = rng.choices(["enter", "hide", "visitor"], weights=[5, 2, 3])[0]
    role = "visitor" if kind == "visitor" else "intruder"
    protect = rng.choices(PROTECTABLE, weights=[4, 1, 1, 1, 1])[0]
    person = {"role": role, "intent": {"enter": "enter", "hide": "hide", "visitor": "wander"}[kind]}
    if kind == "enter":
        person["delay"] = round(rng.uniform(0, 12), 2)
    first = wchoice(rng, I_FIRST[kind])
    then_pool = [g for g in I_TEMPLATES if g not in (first, "hold") and not (role == "visitor" and g in ("driveout", "contain", "keepout"))]
    then = rng.choice(then_pool) if rng.random() < 0.12 and first != "context" else None
    orders = [make_indoor_order(rng, round(rng.uniform(0, 3), 2), "context" if first == "context" else "goal", first, test, role, protect, then=then)]
    goal = orders[0]["intended"].get("goal")
    t = orders[0]["t"]
    for _ in range(rng.choice([0, 1, 1, 2, 2, 3])):
        t += rng.uniform(10, 35)
        r = rng.random()
        if r < 0.08:
            orders.append(make_indoor_order(rng, t, "refuse", rng.choice(list(I_REFUSE)), test, role, protect))
        elif r < 0.14:
            orders.append(make_indoor_order(rng, t, "query", None, test, role, protect))
        else:
            new = wchoice(rng, I_NEXT[kind], exclude=goal)
            orders.append(make_indoor_order(rng, t, "goal", new, test, role, protect, prev_goal=goal))
            goal = new
    layout = "random" if rng.random() < 0.7 else "fixed"
    scenario = {"layout": layout, "protect": protect, "person": person, "endOnGone": kind == "enter",
                "settings": {"rloss": round(rng.uniform(0.0, 0.15), 3), "rlat": round(rng.uniform(0.1, 0.4), 3)}, "secs": 180}
    return {"episode": f"indoor-{i:06d}", "seed": seed, "split": "test" if test else "train", "sim": "indoor", "scenario": scenario, "orders": orders}


def indoor_sweep_pools():
    pools = []
    for g, ts in I_TEMPLATES.items():
        pools += [(t, g) for t, _ in ts]
    return pools


def main():
    p = argparse.ArgumentParser(description="Sample per-episode order schedules for the batch generator")
    p.add_argument("--episodes", type=int, default=200)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out", default="output/dataset/run")
    p.add_argument("--sim", default="mind", choices=["mind", "indoor"])
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    eps = [(indoor_episode if a.sim == "indoor" else episode)(i, a.seed) for i in range(a.episodes)]
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
    if a.sim == "indoor":
        for g, ts in I_TEMPLATES.items():
            for tpl, slot in ts:
                if not held_out(tpl):
                    continue
                for k in range(12):
                    o = make_indoor_order(random.Random(1000 * k + len(sweep)), 0.0, "goal", g, True,
                                          "visitor" if g == "guideout" else "intruder", sweep_rng.choice(PROTECTABLE), pool_override=[(tpl, slot)])
                    sweep.append((tpl, o["text"], not o["mismatch"]))
        pools = []
    else:
        pools = [(t, {"action": "accept", "goal": g}) for g, ts in GOAL_TEMPLATES.items() for t in ts]
    if a.sim != "indoor":
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
