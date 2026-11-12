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


if __name__ == "__main__":
    import json
    import sys
    print(json.dumps(interpret(" ".join(sys.argv[1:]) or "keep him out"), indent=1))
