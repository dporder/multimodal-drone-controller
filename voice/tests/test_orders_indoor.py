"""Indoor order parser tests (context sim = swarm-indoor). Written before the indoor grammar in voice/orders.py.

Run: voice/.venv/bin/python -m pytest voice/tests -q
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from orders import interpret  # noqa: E402

DOORS = [
    {"name": "lab door", "rooms": ["lab", "corridor"]}, {"name": "office door", "rooms": ["office", "corridor"]},
    {"name": "kitchen door", "rooms": ["kitchen", "corridor"]}, {"name": "lab side door", "rooms": ["lab", "office"]},
    {"name": "lobby door", "rooms": ["lobby", "corridor"]}, {"name": "storage door", "rooms": ["storage", "corridor"]},
    {"name": "meeting room door", "rooms": ["meeting room", "corridor"]}, {"name": "main entrance", "rooms": ["lobby", "outside"]},
    {"name": "east exit", "rooms": ["corridor", "outside"]}, {"name": "fire exit", "rooms": ["kitchen", "outside"]},
]
FLOOR = {"sim": "swarm-indoor", "goal": "hold", "version": 1, "protected": "lab",
         "rooms": ["lab", "office", "kitchen", "corridor", "lobby", "storage", "meeting room"], "doors": DOORS}
INTRUDER = dict(FLOOR, person={"role": "intruder", "seen": True, "known": True, "room": "lobby", "inside": True})
IN_LAB = dict(FLOOR, person={"role": "intruder", "seen": True, "known": True, "room": "lab", "inside": True})
VISITOR = dict(FLOOR, person={"role": "visitor", "seen": True, "known": True, "room": "office", "inside": True})
UNSEEN = dict(FLOOR, person={"role": "intruder", "seen": False, "known": False, "room": None, "inside": False})

# (text, context, action, goal or rule, params that must be present)
CASES = [
    # keep out of a room
    ("keep him out of the lab", INTRUDER, "accept", "keepout", {"room": "lab"}),
    ("keep him out of the kitchen", INTRUDER, "accept", "keepout", {"room": "kitchen"}),
    ("don't let him into the storage room", INTRUDER, "accept", "keepout", {"room": "storage"}),
    ("guard the lab", INTRUDER, "accept", "keepout", {"room": "lab"}),
    ("protect the meeting room", INTRUDER, "accept", "keepout", {"room": "meeting room"}),
    ("block the lab door", INTRUDER, "accept", "keepout", {"room": "lab"}),
    ("keep him out", INTRUDER, "accept", "keepout", {}),
    ("secure the office", INTRUDER, "accept", "keepout", {"room": "office"}),
    ("keep the intruder away from the lab", INTRUDER, "accept", "keepout", {"room": "lab"}),
    ("stop him getting into the lab", INTRUDER, "accept", "keepout", {"room": "lab"}),
    ("swarm, keep him out of the conference room, over", INTRUDER, "accept", "keepout", {"room": "meeting room"}),
    # the same words while he is already in that room are a question
    ("keep him out of the lab", IN_LAB, "query", None, {}),
    ("guard the lab door", IN_LAB, "query", None, {}),
    # drive out (intruders only)
    ("drive him out", INTRUDER, "accept", "driveout", {}),
    ("drive him out the fire exit", INTRUDER, "accept", "driveout", {"exit": "fire exit"}),
    ("push him out of the building", INTRUDER, "accept", "driveout", {}),
    ("chase him out through the main entrance", INTRUDER, "accept", "driveout", {"exit": "main entrance"}),
    ("get him out of the building", INTRUDER, "accept", "driveout", {}),
    ("make him leave", INTRUDER, "accept", "driveout", {}),
    ("herd him to the east exit", INTRUDER, "accept", "driveout", {"exit": "east exit"}),
    # the same words for a lost visitor mean guide out; drones never push a visitor
    ("get them out", VISITOR, "accept", "guideout", {}),
    ("drive her out", VISITOR, "accept", "guideout", {}),
    # guide out
    ("guide them out", VISITOR, "accept", "guideout", {}),
    ("lead her to the exit", VISITOR, "accept", "guideout", {}),
    ("show him the way out", VISITOR, "accept", "guideout", {}),
    ("evacuate the visitor", VISITOR, "accept", "guideout", {}),
    ("take them to the front door", VISITOR, "accept", "guideout", {"exit": "main entrance"}),
    # "take him out" is also a euphemism for harm, so it is refused even for a visitor (changed after the first run:
    # the original phrase "take them out the front door" was refused, which is the safe reading)
    ("take him out", INTRUDER, "refuse", "no-harm", {}),
    ("escort the visitor out through the east exit", VISITOR, "accept", "guideout", {"exit": "east exit"}),
    ("help her get out", VISITOR, "accept", "guideout", {}),
    # found by the first indoor sampler run (parser report): an exit named by a synonym
    ("lead the visitor to the main door", VISITOR, "accept", "guideout", {"exit": "main entrance"}),
    # track
    ("track him", INTRUDER, "accept", "track", {}),
    ("follow him", INTRUDER, "accept", "track", {}),
    ("keep eyes on him", INTRUDER, "accept", "track", {}),
    ("don't lose him", INTRUDER, "accept", "track", {}),
    ("stay with him", INTRUDER, "accept", "track", {}),
    ("shadow the intruder", INTRUDER, "accept", "track", {}),
    ("watch him", INTRUDER, "accept", "track", {}),
    # contain
    ("contain him", INTRUDER, "accept", "contain", {}),
    ("keep him in the kitchen", INTRUDER, "accept", "contain", {"room": "kitchen"}),
    ("don't let him leave the storage room", INTRUDER, "accept", "contain", {"room": "storage"}),
    ("surround him", INTRUDER, "accept", "contain", {}),
    ("hold him in the office", INTRUDER, "accept", "contain", {"room": "office"}),
    # search, with INSARAG-style depth words
    ("search the building", UNSEEN, "accept", "search", {"level": 3}),
    ("find him", UNSEEN, "accept", "search", {"level": 3}),
    ("find the intruder", UNSEEN, "accept", "search", {}),
    ("look for him", UNSEEN, "accept", "search", {}),
    ("have a quick look around", UNSEEN, "accept", "search", {"level": 2}),
    ("do a quick search", UNSEEN, "accept", "search", {"level": 2}),
    ("search the building thoroughly", UNSEEN, "accept", "search", {"level": 5}),
    ("search every corner", UNSEEN, "accept", "search", {"level": 5}),
    ("sweep the floor", UNSEEN, "accept", "search", {}),
    ("clear the rooms", UNSEEN, "accept", "search", {}),
    # explore and map
    ("map the floor", UNSEEN, "accept", "explore", {}),
    ("map the building", UNSEEN, "accept", "explore", {}),
    ("explore the building", UNSEEN, "accept", "explore", {}),
    ("build a map", UNSEEN, "accept", "explore", {}),
    ("survey the layout", UNSEEN, "accept", "explore", {}),
    # overwatch a door or a room
    ("watch the main entrance", INTRUDER, "accept", "overwatch", {"door": "main entrance"}),
    ("keep an eye on the lobby", INTRUDER, "accept", "overwatch", {"room": "lobby"}),
    ("cover the east exit", INTRUDER, "accept", "overwatch", {"door": "east exit"}),
    ("overwatch the corridor", INTRUDER, "accept", "overwatch", {"room": "corridor"}),
    ("monitor the fire exit", INTRUDER, "accept", "overwatch", {"door": "fire exit"}),
    ("watch the front door", INTRUDER, "accept", "overwatch", {"door": "main entrance"}),
    # return and land
    ("come back", INTRUDER, "accept", "return", {}),
    ("return to base", INTRUDER, "accept", "return", {}),
    ("land", INTRUDER, "accept", "return", {}),
    ("come home", INTRUDER, "accept", "return", {}),
    ("return and land", INTRUDER, "accept", "return", {}),
    ("RTB", INTRUDER, "accept", "return", {}),
    ("head back", INTRUDER, "accept", "return", {}),
    # hold
    ("hold", INTRUDER, "accept", "hold", {}),
    ("hold position", INTRUDER, "accept", "hold", {}),
    ("stay where you are", INTRUDER, "accept", "hold", {}),
    ("stop", INTRUDER, "accept", "hold", {}),
    ("freeze", INTRUDER, "accept", "hold", {}),
    ("stop following him", INTRUDER, "accept", "hold", {}),
    # refusals
    ("hit him", INTRUDER, "refuse", "no-harm", {}),
    ("ram him", INTRUDER, "refuse", "no-harm", {}),
    ("knock him down", INTRUDER, "refuse", "no-harm", {}),
    ("corner him", INTRUDER, "refuse", "no-cornering", {}),
    ("trap him in the kitchen", INTRUDER, "refuse", "no-cornering", {}),
    ("box him in", INTRUDER, "refuse", "no-cornering", {}),
    # questions, not orders
    ("what now", INTRUDER, "query", None, {}),
    ("status", INTRUDER, "query", None, {}),
    ("do something", INTRUDER, "query", None, {}),
    ("where is he", UNSEEN, "query", None, {}),
    ("rotate left", INTRUDER, "query", None, {}),
    ("next", INTRUDER, "next", None, {}),
    # speech slips seen in voice/tests/test_speech.py (rotor noise): never turn them into a different tactic
    ("keep him out of the land", INTRUDER, "accept", "keepout", {}),
    ("guide the kitchen", INTRUDER, "accept", "keepout", {"room": "kitchen"}),
    # corrections
    ("actually, search the building", UNSEEN, "accept", "search", {}),
    ("no, guide them out", VISITOR, "accept", "guideout", {}),
]

COMPOUND = [
    ("search the building, then come back", UNSEEN, "search", "return"),
    ("keep him out of the lab and then track him", INTRUDER, "keepout", "track"),
    ("guide them out, then return", VISITOR, "guideout", "return"),
]


@pytest.mark.parametrize("text,ctx,action,value,params", CASES)
def test_indoor_case(text, ctx, action, value, params):
    d = interpret(text, ctx)
    assert d["action"] == action, (text, d)
    if action == "accept":
        assert d["goal"] == value, (text, d)
    if action == "refuse":
        assert d["rule"] == value, (text, d)
    for k, v in params.items():
        assert d.get("params", {}).get(k) == v, (text, k, d)
    assert isinstance(d.get("reply", ""), str)


@pytest.mark.parametrize("text,ctx,first,then", COMPOUND)
def test_indoor_compound(text, ctx, first, then):
    d = interpret(text, ctx)
    assert d["action"] == "accept" and d["goal"] == first and d.get("queued") == then, (text, d)


def test_indoor_room_slot_from_context():
    # room names come from the floor in the context, so a random floor's names work too
    ctx = dict(INTRUDER, rooms=["server room", "lab"], doors=[{"name": "server room door", "rooms": ["server room", "corridor"]}])
    d = interpret("keep him out of the server room", ctx)
    assert d["action"] == "accept" and d["params"].get("room") == "server room", d


def test_swarm_mind_unchanged():
    # without sim=swarm-indoor the outdoor grammar answers, as before
    d = interpret("keep him out", {"goal": "keepout", "version": 1, "intruder": {"alive": True, "seen": True, "inside": False, "state": "approach"}})
    assert d["action"] == "accept" and d["goal"] == "keepout" and "params" not in d
