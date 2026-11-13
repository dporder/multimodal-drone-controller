# Orders by voice

Hold Space in Swarm Mind, say an order, and the swarm acts on it. Speech recognition runs on this
machine with [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT). After a one-time
model download, no audio and no text leave the computer.

## Set up (once)

```
python3.12 -m venv voice/.venv
voice/.venv/bin/pip install -r voice/requirements.txt
```

The first start downloads the `base.en` model (about 280 MB) to `~/.cache/huggingface`.

## Run

```
python main.py --voice
```

This starts the speech server on `ws://localhost:8765` and serves Swarm Mind on
`http://127.0.0.1:8000`. Open it in Chrome, hold **Space** (or the *Talk* button) and say, for example:
- "keep him out of the building"
- "drive him out"
- "follow him"
- "hold position"
- "rotate left"

The *Orders by voice* panel shows what was heard, the order applied and its timings. You can also
type an order in the box under it.

**What the parser does:**
- **Harmful orders are refused.** Striking, ramming or cornering a person is never carried out.
- **Unclear orders get a question back.** It never falls back to a default tactic.
- **Context changes the meaning.** "Cover the door" means *keep out* while he is outside, and gets a question while he is inside.
- **Compound orders queue.** "Keep him out, then track him" runs the first and queues the second until you say "next".

The rules live in [`orders.py`](orders.py). The tactics behind each goal are in
[`docs/TACTICS.md`](../docs/TACTICS.md).

## Indoors

```
python main.py indoor --voice
```

Swarm Indoor sends the same messages with `"sim": "swarm-indoor"` and the floor's room and door names, so the
parser switches to the indoor grammar and the recognizer to an indoor vocabulary hint. Say, for example:
- "keep him out of the lab", "guard the kitchen", "block the storage door"
- "drive him out the fire exit" (intruders) · "guide them out by the main entrance" (visitors)
- "track him" · "keep him in the meeting room" · "surround him"
- "have a quick look around" (search level 2) · "search the building" (3) · "search every corner" (5)
- "map the floor" · "watch the main entrance" · "come back and land"
- "search the building, then come back" (the second order runs when the first is done, or on "next")

Context rules indoors:
- **"Get him out" depends on who it is.** Drive out for an intruder, guide out for a lost visitor; "drive her out" for a visitor becomes guide out, because drones never push a visitor.
- **Protecting a room he is already in is a question.** "Keep him out of the lab" while he is in the lab asks: contain him there, or drive him out?
- **Speech slips never become a different tactic.** "Out of the land" is not "land"; "guide the kitchen" is read as "guard the kitchen".

## Tests

```
voice/.venv/bin/python -m pytest voice/tests -q -s
```

- `test_orders.py`: 88 phrasings written before the grammar, including refusals, questions, corrections, compound orders and context.
- `test_orders_indoor.py`: 93 indoor phrasings and 3 compound orders. 89 were written before the indoor grammar; 4 were added from what later tests found (two speech slips, a harm euphemism, an exit synonym). One phrase was changed after the first run: "take them out the front door" was refused, because "take him out" can mean harm, and that refusal is the safe reading.
- `test_speech.py`: 20 orders spoken by 4 macOS voices, clean and with synthetic rotor noise at 10 dB, sent through the server as the page sends them.
  - Result on an M1, 12 Nov 2026: 148/160 correct (92%) with the shipped grammar; median 0.53 s from end of audio to decision.
  - All 12 misses became questions, not wrong tactics.
  - Two confusion rules ("God the" → "guard the", "lock the door" → "block the door") were then added from those misses, so later runs of this test are optimistic.
  - Set `SPEECH_FAST=1` for a quick run.
  - Indoors (`test_spoken_indoor_orders`): 12 indoor orders, same voices and noise. First run 93/96 (97%); one miss was unsafe ("lab" heard as "land" became *return*). After two grammar rules for those slips: 95/96 (99%). The remaining miss still keeps him out of the protected room, without naming it.

macOS `say` voices are for internal tests only and are never released as data.

## Latency options

Measured on 30 clean clips, M1:

| Model | Device | Median | Correct |
|---|---|---|---|
| tiny.en | CPU | 273 ms | 27/30 |
| base.en | CPU | 541 ms | 30/30 |
| base.en | `--device mps` (experimental) | 492 ms | 30/30 |

`base.en` on CPU is the default: it is the most accurate, and CPU is what a Raspberry Pi or Jetson will run. Use `python voice/server.py --model tiny.en` to halve the latency at some cost in accuracy.

## Logs

Each order's transcript, decision, context and timings are appended to `output/voice/log.jsonl`. Audio is only kept with `--save-audio`. The log is a seed for the operator-phrasing side of the dataset; see [`docs/DATASET_PLAN.md`](../docs/DATASET_PLAN.md).
