"""Order parser v0: turn a transcript (plus what the swarm knows) into an order for Swarm Mind.

    interpret(text, context) -> decision

decision = {
  "action":  "accept" | "query" | "refuse" | "ignore" | "next",
  "goal":    "keepout" | "driveout" | "track" | "hold"     (accept, goal order)
  "turn":    "L" | "R"                                     (accept, formation turn)
  "queued":  goal                                          (compound "X, then Y": Y waits for "next")
  "rule":    "no-harm" | "no-cornering"                    (refuse)
  "reply":   text read back to the operator
  "normalized", "vague", "clauses"
}

context (sent by the page): {"goal", "version", "intruder": {"alive", "seen", "inside", "state"}}.

Rules, in order: refusals are checked on the whole utterance before anything else, so a harmful
clause anywhere refuses the order; unclear words always produce a question, never a default
tactic; the same words can mean different things in different situations ("cover the door").
This is a deterministic rule table on purpose: it is the label source for the dataset sampler
and the safety layer under any learned parser. See docs/TACTICS.md for the tactics themselves.

Indoor (context["sim"] == "swarm-indoor") adds goals guideout, contain, search, explore, overwatch and
return, and slots read from the floor in the context: decision["params"] = {"room", "door", "exit", "level"}.
"""
import re

GOALS = {
    "keepout": "Keep him out of the building",
    "driveout": "Drive him out of the site",
    "track": "Track him",
    "hold": "Hold position",
}
OPTIONS = "keep him out, drive him out, track him, hold, or rotate the formation"

# Speech-recognition slips seen on short commands. Extend from the sampler's mismatch report.
CONFUSIONS = [
    (r"\bdry (him|her|them|em) out\b", r"drive \1 out"),
    (r"\bdrive in out\b", "drive him out"),
    (r"\b(trek|truck|trak|trac|trick) (him|her|them|em)\b", r"track \2"),
    (r"\b(whole|hole|old) (position|on|up)\b", r"hold \2"),
    (r"\b(follow|watch|track|keep) (em|um|im)\b", r"\1 him"),
    (r"\bkeep (em|um|im) (out|away)\b", r"keep him \2"),
    (r"\bstand-by\b", "stand by"),
    # found by voice/tests/test_speech.py with synthetic rotor noise (12 Nov 2026)
    (r"\b(god|gourd|guarded) the\b", "guard the"),
    (r"\block the (\w+ )?(door|doors|entrance|way)\b", r"block the \1\2"),
    (r"\bscott? (following|tracking|watching)\b", r"stop \1"),
]
FILLERS = {
    "uh", "um", "uhm", "er", "erm", "hmm", "ok", "okay", "so", "please", "now", "swarm", "drones", "drone",
    "team", "guys", "everyone", "everybody", "all", "alright", "just", "quickly", "immediately", "can",
    "could", "would", "kindly", "hey", "yeah",
}
CORRECTIONS = {"no", "nope", "actually", "sorry", "wait", "scratch that", "correction", "change of plan"}
PERSON = r"(?:him|her|them|it|the intruder|the person|the guy|that guy|that man|the man|that person|the woman|that woman)"

HARM = re.compile(
    r"\b(hit|strike|attack|hurt|harm|injure|wound|shoot|kill|ram|rams|ramming|punch|tase|taser|spray|smash|bash|"
    r"crash into|fly into|dive (?:at|into)|knock " + PERSON + r"? ?(?:down|over|out)|take " + PERSON + r" (?:down|out))\b")
CORNER = re.compile(r"\b(corner|trap|pin|box in) " + PERSON + r"\b|\btrap " + PERSON)

STOP_DOING = re.compile(r"\b(stop|quit|cease) (following|tracking|watching|chasing|pushing|driving|blocking)\b|^(stop|quit|cease) (that|it)$")
NOT_LET_IN = re.compile(r"\b(?:don't|dont|do not) let " + PERSON + r" (?:get |go |come )?(?:in|inside|enter|through|into)\b")
NOT_LOSE = re.compile(r"\b(?:don't|dont|do not) (?:lose|let " + PERSON + r" (?:get away|escape|out of (?:your )?sight))\b")
NEGATION = re.compile(r"\b(don't|dont|do not|never)\b")
DOOR = re.compile(r"\b(cover|watch|hold|guard|block|mind|secure) the (?:\w+ )?(door|doors|entrance|entry|doorway)\b")
TURN = [
    re.compile(r"^(?:go |more |a bit |a little |slightly |bit )*(?:to the |to )?(left|right)$"),
    re.compile(r"\b(rotate|turn|swing|shift|slide|move|bring|wheel) (?:the )?(?:formation |swarm |line |team )?(?:to the |to |a bit |more )*(left|right)\b"),
]
DRIVE = [
    re.compile(r"\b(drive|push|chase|kick|herd|move|send|escort|shoo|run|force|steer|usher|shepherd)\b.*\b(out|off|away|back|toward|towards|outside)\b"),
    re.compile(r"\bget " + PERSON + r"? ?(?:out|off)\b"),
    re.compile(r"\bget rid of\b"),
    re.compile(r"\bmake " + PERSON + r" (?:leave|go)\b"),
    re.compile(r"\bclear (?:the site|the yard|the area|the property|the premises|" + PERSON + r")\b"),
]
VAGUE_DRIVE = re.compile(r"\bget rid of\b|\bdeal with\b")
KEEP = [
    re.compile(r"\bkeep\b.*\b(out|away)\b"),
    re.compile(r"\bblock\b"),
    re.compile(r"\b(guard|protect|defend|secure)\b"),
    re.compile(r"\bstop " + PERSON + r"\b.*\b(in|inside|entering|enter|getting in|going in)\b"),
    re.compile(r"\bdeny\b.*\b(entry|access|entrance)\b"),
    # found by voice/sampler.py's mismatch report (12 Nov 2026)
    re.compile(r"\bkeep " + PERSON + r" from\b"),
    re.compile(r"\bstays? (?:out|away|outside)\b"),
    re.compile(r"\bkeep the (?:building|warehouse|door|doors|entrance|site) (?:clear|empty|secure|safe)\b"),
]
TRACK = [
    re.compile(r"\b(track|follow|shadow|tail|monitor|trail|pursue)\b"),
    re.compile(r"\bkeep (?:an )?eye on\b|\beyes on\b"),
    re.compile(r"\bkeep " + PERSON + r" in (?:sight|view)\b"),
    re.compile(r"\bkeep (?:watching|tracking|following)\b"),
    re.compile(r"\bwatch " + PERSON + r"\b"),
    re.compile(r"\bstay (?:on|with) " + PERSON + r"\b"),
]
HOLD = [
    re.compile(r"\b(hold|freeze|halt|hover|wait|stop|pause)\b"),
    re.compile(r"\bstay (?:where (?:you )?are|put|there|here|in place)\b"),
    re.compile(r"\bstand ?by\b"),
]
NEXT = re.compile(r"^(next|go ahead|proceed|next order|continue|carry on)$")
THEN = re.compile(r"\s*(?:,\s*)?\b(?:and then|then|after that|afterwards|and afterwards)\b\s*")


def normalize(text):
    t = (text or "").lower().replace("’", "'").replace("‘", "'")
    t = re.sub(r"[^a-z0-9',\s-]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    for pat, rep in CONFUSIONS:
        t = re.sub(pat, rep, t)
    t = re.sub(r"\bright now\b", "now", t)
    t = re.sub(r",?\s*\bover(?: and out)?$", "", t).strip(" ,")  # radio pro-word "..., over"
    return t


def _strip(clause):
    words = [w for w in clause.replace(",", " ").split() if w not in FILLERS]
    return " ".join(words)


def _drop_correction_prefix(t):
    parts = [p.strip() for p in t.split(",")]
    # drop "no, …" / "actually, …" only when something meaningful follows ("wait, now" means wait)
    while len(parts) > 1 and _strip(parts[0]) in CORRECTIONS | {""} and _strip(" ".join(parts[1:])):
        parts = parts[1:]
    return ", ".join(parts)


def _classify(clause, ctx):
    """One clause -> (kind, value, extra). kind: goal | turn | query | ignore | next | door."""
    c = _strip(clause)
    if not c:
        return ("ignore", None, {})
    if NEXT.match(c):
        return ("next", None, {})
    if STOP_DOING.search(c):
        return ("goal", "hold", {})
    if NOT_LET_IN.search(c):
        return ("goal", "keepout", {})
    if NOT_LOSE.search(c):
        return ("goal", "track", {})
    if NEGATION.search(c):
        return ("query", None, {"why": "negation"})
    if DOOR.search(c):
        return ("door", None, {})
    for rx in TURN:
        m = rx.search(c)
        if m:
            return ("turn", "L" if m.groups()[-1] == "left" else "R", {})
    if any(rx.search(c) for rx in DRIVE):
        return ("goal", "driveout", {"vague": bool(VAGUE_DRIVE.search(c))})
    if any(rx.search(c) for rx in KEEP):
        return ("goal", "keepout", {})
    if any(rx.search(c) for rx in TRACK):
        return ("goal", "track", {})
    if any(rx.search(c) for rx in HOLD):
        return ("goal", "hold", {})
    return ("query", None, {"why": "unknown"})


def interpret(text, context=None):
    ctx = context or {}
    if ctx.get("sim") == "swarm-indoor":
        return interpret_indoor(text, ctx)
    who = (ctx.get("intruder") or {})
    norm = normalize(text)
    base = {"normalized": norm, "vague": False}

    # 1. safety first, on the whole utterance
    flat = _strip(norm)
    if HARM.search(flat):
        return dict(base, action="refuse", rule="no-harm",
                    reply="I won't do that: the drones never strike, ram or hurt a person. I can " + OPTIONS + ".")
    if CORNER.search(flat):
        return dict(base, action="refuse", rule="no-cornering",
                    reply="I won't corner or trap a person. I can " + OPTIONS + ".")

    # 2. corrections and compound orders
    t = _drop_correction_prefix(norm)
    clauses = [c for c in THEN.split(t) if c and c.strip(" ,")]
    if not clauses:
        return dict(base, action="ignore", reply="")
    decided = []
    for cl in clauses:
        kind, val, extra = _classify(cl, ctx)
        if kind == "door":  # same words, meaning depends on where he is
            if who.get("inside"):
                return dict(base, action="query", clauses=clauses,
                            reply="He's already inside. Hold at the door, or drive him out?")
            kind, val = "goal", "keepout"
        decided.append((kind, val, extra))
    base["clauses"] = clauses

    kinds = [d[0] for d in decided]
    if all(k == "ignore" for k in kinds):
        return dict(base, action="ignore", reply="")
    first = next(d for d in decided if d[0] != "ignore")
    if first[0] == "next":
        return dict(base, action="next", reply="")
    if first[0] == "query":
        why = first[2].get("why")
        reply = ("Say what to do instead: " + OPTIONS + "?") if why == "negation" else ("Say again? I can " + OPTIONS + ".")
        return dict(base, action="query", reply=reply)
    if first[0] == "turn":
        return dict(base, action="accept", turn=first[1],
                    reply="Rotating the formation " + ("left" if first[1] == "L" else "right") + ".")

    goal = first[1]
    out = dict(base, action="accept", goal=goal, vague=bool(first[2].get("vague")))
    reply = GOALS[goal] + "."
    if out["vague"]:
        reply = "Reading that as: " + GOALS[goal].lower() + "."
    if goal in ("track", "driveout") and not who.get("alive", True):
        reply += " Nobody in sight yet, so the drones search first."
    rest = [d for d in decided[decided.index(first) + 1:] if d[0] == "goal"]
    if rest:
        out["queued"] = rest[0][1]
        reply += " Then: " + GOALS[rest[0][1]].lower() + " (say 'next')."
    out["reply"] = reply
    return out


# ---------------------------------------------------------------------------------------------
# Indoor grammar (simulators/swarm-indoor). Same order of rules: refusals first, then corrections
# and compound orders, then one goal per clause, with room, door and exit slots from the floor.

INDOOR_GOALS = {
    "hold": "Hold position", "keepout": "Keep him out", "driveout": "Drive him out", "guideout": "Guide them out",
    "track": "Track him", "contain": "Contain him", "search": "Search the building", "explore": "Map the floor",
    "overwatch": "Watch", "return": "Return and land",
}
INDOOR_OPTIONS = ("keep him out of a room, drive him out, guide them out, track him, contain him, search the building, "
                  "map the floor, watch a door, hold, or come back and land")
ROOM_SYNONYMS = {
    "laboratory": "lab", "storeroom": "storage", "store room": "storage", "storage room": "storage", "stock room": "storage",
    "hallway": "corridor", "hall": "corridor", "passage": "corridor", "conference room": "meeting room",
    "boardroom": "meeting room", "reception": "lobby", "foyer": "lobby", "entrance hall": "lobby", "break room": "kitchen",
    "canteen": "kitchen",
}
DOOR_SYNONYMS = {
    "front door": "main entrance", "main door": "main entrance", "front entrance": "main entrance", "entrance": "main entrance",
    "emergency exit": "fire exit", "east door": "east exit", "back door": "fire exit",
}
PERSON_IN = r"(?:him|her|them|it|the intruder|the person|the guy|that guy|the man|the woman|the visitor|the guest)"
I_KEEP_OUT = [
    re.compile(r"\bkeep\b.*\b(out|away)\b"), re.compile(r"\bblock\b"), re.compile(r"\b(guard|protect|defend|secure)\b"),
    re.compile(r"\b(?:don't|dont|do not) let " + PERSON_IN + r" (?:get |go |come )?(?:in|inside|into|enter|through)\b"),
    re.compile(r"\bstop " + PERSON_IN + r"\b.*\b(in|inside|into|entering|enter|getting)\b"), re.compile(r"\bdeny\b.*\b(entry|access)\b"),
    re.compile(r"\bstays? (?:out|away)\b"),
]
I_DOOR_HOLD = re.compile(r"\b(hold|guard|block|secure|mind)\b")
I_RETURN = re.compile(r"\b(return|come back|come home|go home|head home|head back|go back to base|back to base|(?<!the )land|rtb|recall|fly back)\b")
I_EXPLORE = re.compile(r"\b(map|explore|survey|chart)\b|\b(?:build|make) a map\b|\bscan the (?:floor|building|layout|place)\b")
I_SEARCH = re.compile(r"\b(search|find|locate|sweep|hunt for|look for|look around|look about)\b|\b(?:clear|check) (?:the |every |all )?(?:rooms?|building|floor)\b")
# depth words count only next to a search word: "quick, find him" is urgency, "a quick search" is INSARAG level 2
I_QUICK = re.compile(r"\b(?:quick|quickly|fast|rapid|hasty|brief|briefly)\b (?:\w+ )?(?:search|look|check|sweep|scan)|\b(?:search|look|check|sweep)\w* (?:\w+ )?(?:quickly|briefly|fast)\b|\bglance\b")
I_THOROUGH = re.compile(r"\b(thorough|thoroughly|every (?:corner|inch|nook)|detailed|carefully|careful|completely|top to bottom|leave no)\b")
I_GUIDE = [
    re.compile(r"\b(guide|lead|show|evacuate|help)\b"), re.compile(r"\bwalk " + PERSON_IN + r" (?:out|to)\b"),
]
I_CONTEXT_OUT = [  # "get him out": drive out for an intruder, guide out for a visitor
    re.compile(r"\bget " + PERSON_IN + r"? ?(?:out|outside)\b"), re.compile(r"\b(escort|take|bring|usher|see) " + PERSON_IN + r"\b.*\b(out|outside|exit|door|entrance)\b"),
]
I_TRACK = [
    re.compile(r"\b(track|follow|shadow|tail|trail|pursue)\b"), re.compile(r"\bkeep (?:an )?eye on " + PERSON_IN + r"\b|\beyes on " + PERSON_IN + r"\b"),
    re.compile(r"\bkeep " + PERSON_IN + r" in (?:sight|view)\b"), re.compile(r"\bkeep (?:watching|tracking|following)\b"),
    re.compile(r"\b(?:watch|monitor) " + PERSON_IN + r"\b"), re.compile(r"\bstay (?:on|with) " + PERSON_IN + r"\b"),
]
HARM_IN = re.compile(HARM.pattern.replace(PERSON, PERSON_IN))
CORNER_IN = re.compile(r"\b(corner|trap|pin) " + PERSON_IN + r"\b|\b(box|hem|pen) " + PERSON_IN + r" in\b|\btrap\b|\bbox " + PERSON_IN + r"\b")
I_DRIVE = [
    re.compile(r"\b(drive|push|chase|kick|herd|move|send|shoo|run|force|steer|shepherd)\b.*\b(out|off|away|back|toward|towards|outside|to the)\b"),
    re.compile(r"\bmake " + PERSON_IN + r" (?:leave|go)\b"), re.compile(r"\bget rid of\b"),
]
I_CONTAIN = [
    re.compile(r"\b(contain|surround|encircle|isolate|cordon)\b"), re.compile(r"\bkeep " + PERSON_IN + r" (?:(?:in|inside)\b(?! (?:sight|view))|where\b)"),
    re.compile(r"\b(?:don't|dont|do not) let " + PERSON_IN + r" (?:leave|out of|get out of|escape)\b"), re.compile(r"\bhold " + PERSON_IN + r" (?:in|there|inside)\b"),
]
I_OVERWATCH = re.compile(r"\b(watch|overwatch|observe|monitor|cover|eyes on|keep (?:an )?eye on|keep watch on|look after)\b")
I_TURN = re.compile(r"\b(rotate|turn|swing|wheel)\b.*\b(left|right)\b|^(?:more |a bit )?(?:to the )?(left|right)$")


def _names(ctx):
    rooms = [r for r in (ctx.get("rooms") or [])]
    doors = [d["name"] if isinstance(d, dict) else str(d) for d in (ctx.get("doors") or [])]
    return rooms, doors


def _find_name(c, names, synonyms):
    """Longest floor name (or synonym) mentioned in the clause."""
    best = None
    for n in sorted(names, key=len, reverse=True):
        if re.search(r"\b" + re.escape(n) + r"(?: room)?\b", c):
            return n
    for syn, n in sorted(synonyms.items(), key=lambda kv: -len(kv[0])):
        if n in names and re.search(r"\b" + re.escape(syn) + r"\b", c):
            best = best or n
    return best


def _door_rooms(ctx, door):
    for d in ctx.get("doors") or []:
        if isinstance(d, dict) and d.get("name") == door:
            return d.get("rooms") or []
    return []


def _slots(c, ctx):
    rooms, doors = _names(ctx)
    door = _find_name(c, doors, DOOR_SYNONYMS)
    if door and re.search(r"\b" + re.escape(door) + r"\b", c) is None and door not in DOOR_SYNONYMS.values():
        door = None
    # a room name inside a door name ("lab door") is the door, not the room
    c_wo_door = re.sub(r"\b" + re.escape(door) + r"\b", " ", c) if door else c
    for syn, n in DOOR_SYNONYMS.items():
        c_wo_door = re.sub(r"\b" + re.escape(syn) + r"\b", " ", c_wo_door)
    room = _find_name(c_wo_door, rooms, ROOM_SYNONYMS)
    if re.search(r"\b(this room|in here|this one)\b", c):
        room = room or "this room"
    exits = [d["name"] for d in ctx.get("doors") or [] if isinstance(d, dict) and "outside" in (d.get("rooms") or [])]
    exit_ = door if door in exits else None
    return room, door, exit_


def _indoor_clause(clause, ctx):
    """One clause -> (kind, goal, params, extra). kind: goal | query | ignore | next | refuse-turn."""
    c = _strip(clause)
    if not c:
        return ("ignore", None, {}, {})
    if NEXT.match(c):
        return ("next", None, {}, {})
    person = ctx.get("person") or {}
    role = person.get("role") or "intruder"
    room, door, exit_ = _slots(c, ctx)
    if STOP_DOING.search(c):
        return ("goal", "hold", {}, {})
    # speech slip found by voice/tests/test_speech.py: "guard the kitchen" heard as "guide the kitchen"; nobody guides a room
    places = [re.escape(n) for n in _names(ctx)[0] + _names(ctx)[1]]
    if places and re.match(r"^guide the (?:" + "|".join(places) + r")\b", c) and not re.search(r"\b(out|outside)\b", c):
        c = "guard" + c[len("guide"):]
    if NOT_LOSE.search(c):
        return ("goal", "track", {}, {})
    if any(rx.search(c) for rx in I_CONTAIN):
        return ("goal", "contain", {"room": room} if room else {}, {})
    if any(rx.search(c) for rx in I_KEEP_OUT) and re.search(r"\b(?:don't|dont|do not) let\b", c):
        pass  # handled below as keep out
    elif NEGATION.search(c):
        return ("query", None, {}, {"why": "negation"})
    if I_TURN.search(c):
        return ("query", None, {}, {"why": "turn"})
    if I_RETURN.search(c) and not re.search(r"\b(push|drive|chase)\b", c):
        return ("goal", "return", {}, {})
    if I_EXPLORE.search(c):
        return ("goal", "explore", {}, {})
    if any(rx.search(c) for rx in I_GUIDE) and (exit_ or re.search(r"\b(out|outside|exit|way out|to safety|evacuate|front door|entrance)\b", c)) \
            or re.search(r"\bevacuate\b", c):
        return ("goal", "guideout", {"exit": exit_} if exit_ else {}, {})
    if any(rx.search(c) for rx in I_CONTEXT_OUT):
        g = "guideout" if role == "visitor" else "driveout"
        return ("goal", g, {"exit": exit_} if exit_ else {}, {"context": True})
    if any(rx.search(c) for rx in I_DRIVE):
        if role == "visitor":
            return ("goal", "guideout", {"exit": exit_} if exit_ else {}, {"softened": True})
        return ("goal", "driveout", {"exit": exit_} if exit_ else {}, {"vague": bool(VAGUE_DRIVE.search(c))})
    if I_SEARCH.search(c):
        raw = clause.lower()
        level = 2 if I_QUICK.search(raw) else 5 if I_THOROUGH.search(raw) else 3
        return ("goal", "search", {"level": level}, {})
    if I_OVERWATCH.search(c) and (door or room) and not re.search(r"\b" + PERSON_IN + r"\b", c):
        return ("goal", "overwatch", {"door": door} if door else {"room": room}, {})
    if door and I_DOOR_HOLD.search(c):  # "hold the lab door": keep him out of the room behind it
        inner = [r for r in _door_rooms(ctx, door) if r != "outside"]
        target = room or (inner[0] if inner else None)
        return ("goal", "keepout", {"room": target} if target else {}, {"door_rule": True})
    if any(rx.search(c) for rx in I_KEEP_OUT):
        return ("goal", "keepout", {"room": room} if room else {}, {})
    if any(rx.search(c) for rx in I_TRACK):
        return ("goal", "track", {}, {})
    if any(rx.search(c) for rx in HOLD):
        return ("goal", "hold", {}, {})
    if re.search(r"\b(lose|lost)\b", c):
        return ("goal", "track", {}, {})
    return ("query", None, {}, {"why": "unknown"})


def _describe_indoor(goal, params, ctx):
    p = params or {}
    if goal == "keepout":
        return "Keep him out of the " + (p.get("room") or ctx.get("protected") or "protected room")
    if goal in ("driveout", "guideout") and p.get("exit"):
        return INDOOR_GOALS[goal] + " by the " + p["exit"]
    if goal == "contain" and p.get("room"):
        return "Contain him in the " + p["room"]
    if goal == "search":
        return "Search the building (" + {2: "quick look", 3: "standard", 5: "thorough"}.get(p.get("level", 3), "standard") + ")"
    if goal == "overwatch":
        return "Watch the " + (p.get("door") or p.get("room") or "main entrance")
    return INDOOR_GOALS[goal]


def interpret_indoor(text, ctx):
    norm = normalize(text)
    base = {"normalized": norm, "vague": False}
    flat = _strip(norm)
    if HARM.search(flat) or HARM_IN.search(flat):
        return dict(base, action="refuse", rule="no-harm",
                    reply="I won't do that: the drones never strike, ram or hurt a person. I can " + INDOOR_OPTIONS + ".")
    if CORNER.search(flat) or CORNER_IN.search(flat):
        return dict(base, action="refuse", rule="no-cornering",
                    reply="I won't corner or trap a person. I can contain him by watching the doors, or " + INDOOR_OPTIONS + ".")
    t = _drop_correction_prefix(norm)
    clauses = [c for c in THEN.split(t) if c and c.strip(" ,")]
    if not clauses:
        return dict(base, action="ignore", reply="")
    decided = [_indoor_clause(c, ctx) for c in clauses]
    base["clauses"] = clauses
    if all(d[0] == "ignore" for d in decided):
        return dict(base, action="ignore", reply="")
    first = next(d for d in decided if d[0] != "ignore")
    if first[0] == "next":
        return dict(base, action="next", reply="")
    if first[0] == "query":
        why = first[3].get("why")
        reply = {"negation": "Say what to do instead: " + INDOOR_OPTIONS + "?",
                 "turn": "Indoors the drones take goals, not formation turns: " + INDOOR_OPTIONS + "."}.get(
            why, "Say again? I can " + INDOOR_OPTIONS + ".")
        return dict(base, action="query", reply=reply)
    goal, params, extra = first[1], {k: v for k, v in first[2].items() if v is not None}, first[3]
    person = ctx.get("person") or {}
    where = person.get("room")
    # context: protecting a room he is already in is a question, not a tactic
    if goal == "keepout" and where and where == (params.get("room") or ctx.get("protected")):
        return dict(base, action="query", clauses=clauses,
                    reply="He's already in the " + where + ". Contain him there, or drive him out?")
    out = dict(base, action="accept", goal=goal, params=params, vague=bool(extra.get("vague")))
    reply = _describe_indoor(goal, params, ctx) + "."
    if extra.get("softened"):
        reply = "That's a visitor: guiding them out instead. Drones don't push visitors."
    elif out["vague"]:
        reply = "Reading that as: " + _describe_indoor(goal, params, ctx).lower() + "."
    if goal in ("track", "driveout", "contain") and not person.get("known", True):
        reply += " Nobody seen yet, so the drones search first."
    rest = [d for d in decided[decided.index(first) + 1:] if d[0] == "goal"]
    if rest:
        out["queued"] = rest[0][1]
        out["queued_params"] = {k: v for k, v in rest[0][2].items() if v is not None}
        reply += " Then: " + _describe_indoor(rest[0][1], out["queued_params"], ctx).lower() + "."
    out["reply"] = reply
    return out


def describe(goal):
    return GOALS.get(goal) or INDOOR_GOALS.get(goal) or goal


if __name__ == "__main__":
    import json
    import sys
    print(json.dumps(interpret(" ".join(sys.argv[1:]) or "keep him out"), indent=1))
