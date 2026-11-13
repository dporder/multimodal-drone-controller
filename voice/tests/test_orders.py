"""Order parser tests. The phrase set was written before the grammar in voice/orders.py.

Run: voice/.venv/bin/python -m pytest voice/tests -q
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from orders import interpret  # noqa: E402

OUTSIDE = {"goal": "keepout", "version": 1, "intruder": {"alive": True, "seen": True, "inside": False, "state": "approach"}}
INSIDE = {"goal": "keepout", "version": 1, "intruder": {"alive": True, "seen": False, "inside": True, "state": "inside"}}
GONE = {"goal": "keepout", "version": 1, "intruder": {"alive": False, "seen": False, "inside": False, "state": "gone"}}

# (text, context, expected action, expected goal / turn / rule)
CASES = [
    # keep out
    ("keep him out", OUTSIDE, "accept", "keepout"),
    ("keep him out of the building", OUTSIDE, "accept", "keepout"),
    ("keep the intruder away from the doors", OUTSIDE, "accept", "keepout"),
    ("don't let him in", OUTSIDE, "accept", "keepout"),
    ("do not let him get inside", OUTSIDE, "accept", "keepout"),
    ("block the entrance", OUTSIDE, "accept", "keepout"),
    ("block him", OUTSIDE, "accept", "keepout"),
    ("guard the building", OUTSIDE, "accept", "keepout"),
    ("protect the warehouse", OUTSIDE, "accept", "keepout"),
    ("stop him getting in", OUTSIDE, "accept", "keepout"),
    ("deny him entry", OUTSIDE, "accept", "keepout"),
    ("Keep them out, now.", OUTSIDE, "accept", "keepout"),
    ("uh, keep, keep him out of there", OUTSIDE, "accept", "keepout"),
    ("swarm, keep him away from the main door", OUTSIDE, "accept", "keepout"),
    ("could you please keep him out of the building", OUTSIDE, "accept", "keepout"),
    # drive out
    ("drive him out", OUTSIDE, "accept", "driveout"),
    ("drive him out of the site", OUTSIDE, "accept", "driveout"),
    ("get him out of here", OUTSIDE, "accept", "driveout"),
    ("push him back", OUTSIDE, "accept", "driveout"),
    ("chase him off the site", OUTSIDE, "accept", "driveout"),
    ("kick him out", OUTSIDE, "accept", "driveout"),
    ("move him off the property", OUTSIDE, "accept", "driveout"),
    ("send him away", OUTSIDE, "accept", "driveout"),
    ("herd him toward the fence", OUTSIDE, "accept", "driveout"),
    ("make him leave", OUTSIDE, "accept", "driveout"),
    ("get rid of him", OUTSIDE, "accept", "driveout"),
    ("escort him off the premises", OUTSIDE, "accept", "driveout"),
    ("push him out of the yard", OUTSIDE, "accept", "driveout"),
    ("dry him out", OUTSIDE, "accept", "driveout"),  # common speech-recognition slip
    # track
    ("track him", OUTSIDE, "accept", "track"),
    ("follow him", OUTSIDE, "accept", "track"),
    ("keep an eye on him", OUTSIDE, "accept", "track"),
    ("watch him", OUTSIDE, "accept", "track"),
    ("shadow him", OUTSIDE, "accept", "track"),
    ("stay on him", OUTSIDE, "accept", "track"),
    ("keep him in sight", OUTSIDE, "accept", "track"),
    ("don't lose him", OUTSIDE, "accept", "track"),
    ("tail him", OUTSIDE, "accept", "track"),
    ("monitor the intruder", OUTSIDE, "accept", "track"),
    ("drones, follow that guy", OUTSIDE, "accept", "track"),
    ("keep watching him", OUTSIDE, "accept", "track"),
    ("don't let him get away", OUTSIDE, "accept", "track"),
    ("trek him", OUTSIDE, "accept", "track"),  # speech-recognition slip
    # hold
    ("hold", OUTSIDE, "accept", "hold"),
    ("hold position", OUTSIDE, "accept", "hold"),
    ("stay where you are", OUTSIDE, "accept", "hold"),
    ("stop", OUTSIDE, "accept", "hold"),
    ("freeze", OUTSIDE, "accept", "hold"),
    ("hover there", OUTSIDE, "accept", "hold"),
    ("everyone hold", OUTSIDE, "accept", "hold"),
    ("stand by", OUTSIDE, "accept", "hold"),
    ("wait here", OUTSIDE, "accept", "hold"),
    ("stop following him", OUTSIDE, "accept", "hold"),
    ("ok swarm, hold up", OUTSIDE, "accept", "hold"),
    ("whole position", OUTSIDE, "accept", "hold"),  # speech-recognition slip
    # formation turns
    ("rotate left", OUTSIDE, "accept", "L"),
    ("turn the formation right", OUTSIDE, "accept", "R"),
    ("swing left", OUTSIDE, "accept", "L"),
    ("more to the right", OUTSIDE, "accept", "R"),
    ("left", OUTSIDE, "accept", "L"),
    ("right", OUTSIDE, "accept", "R"),
    ("rotate the formation to the left", OUTSIDE, "accept", "L"),
    # refusals: never accepted, whatever the wording
    ("hit him", OUTSIDE, "refuse", "no-harm"),
    ("attack the intruder", OUTSIDE, "refuse", "no-harm"),
    ("ram him", OUTSIDE, "refuse", "no-harm"),
    ("knock him down", OUTSIDE, "refuse", "no-harm"),
    ("take him down", OUTSIDE, "refuse", "no-harm"),
    ("shoot him", OUTSIDE, "refuse", "no-harm"),
    ("crash into him", OUTSIDE, "refuse", "no-harm"),
    ("corner him", OUTSIDE, "refuse", "no-cornering"),
    ("trap him in the corner", OUTSIDE, "refuse", "no-cornering"),
    # unclear: a question back, never a default tactic
    ("what's the weather like", OUTSIDE, "query", None),
    ("go to the moon", OUTSIDE, "query", None),
    ("do something", OUTSIDE, "query", None),
    ("keep him", OUTSIDE, "query", None),
    ("go", OUTSIDE, "query", None),
    ("don't follow him", OUTSIDE, "query", None),
    ("cancel that", OUTSIDE, "query", None),
    # nothing said
    ("", OUTSIDE, "ignore", None),
    ("um", OUTSIDE, "ignore", None),
    # corrections
    ("no, keep him out", OUTSIDE, "accept", "keepout"),
    ("actually, track him", OUTSIDE, "accept", "track"),
    ("wait, drive him out", OUTSIDE, "accept", "driveout"),
    # context: same words, different meaning
    ("cover the door", OUTSIDE, "accept", "keepout"),
    ("cover the door", INSIDE, "query", None),
    ("watch the main door", OUTSIDE, "accept", "keepout"),
    ("get him out", INSIDE, "accept", "driveout"),
    ("follow him", GONE, "accept", "track"),
]


def check(text, ctx, action, expect):
    d = interpret(text, ctx)
    if d["action"] != action:
        return False, d
    if action == "accept":
        got = d.get("goal") or d.get("turn")
        return got == expect, d
    if action == "refuse":
        return d.get("rule") == expect, d
    return True, d


def test_accuracy_at_least_95_percent():
    fails = []
    for text, ctx, action, expect in CASES:
        ok, d = check(text, ctx, action, expect)
        if not ok:
            fails.append(f"{text!r}: want {action}/{expect}, got {d['action']}/{d.get('goal') or d.get('turn') or d.get('rule')}")
    acc = 1 - len(fails) / len(CASES)
    print(f"\nparser accuracy {acc:.1%} on {len(CASES)} phrases")
    for f in fails:
        print("  miss:", f)
    assert acc >= 0.95, "\n".join(fails)


@pytest.mark.parametrize("text", [t for t, _, a, _ in CASES if a == "refuse"] + [
    "please attack him now", "fly into him", "hurt him", "take him out", "smash into the guy",
])
def test_harmful_orders_are_never_accepted(text):
    assert interpret(text, OUTSIDE)["action"] == "refuse"


@pytest.mark.parametrize("text", ["what", "drones", "the door", "him", "I think so", "blue"])
def test_unclear_orders_never_default_to_a_tactic(text):
    assert interpret(text, OUTSIDE)["action"] in ("query", "ignore")


def test_compound_order_runs_the_first_and_queues_the_second():
    d = interpret("hold the door, then follow him", OUTSIDE)
    assert d["action"] == "accept" and d["goal"] == "keepout" and d.get("queued") == "track"
    d = interpret("keep him out and then track him", OUTSIDE)
    assert d["goal"] == "keepout" and d.get("queued") == "track"


def test_decisions_carry_a_reply_for_queries_and_refusals():
    for text in ["go", "hit him", "cover the door"]:
        ctx = INSIDE if text == "cover the door" else OUTSIDE
        d = interpret(text, ctx)
        assert d["reply"] and isinstance(d["reply"], str)
