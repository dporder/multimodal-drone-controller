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

## Tests

```
voice/.venv/bin/python -m pytest voice/tests -q -s
```

- `test_orders.py`: 88 phrasings written before the grammar, including refusals, questions, corrections, compound orders and context.
- `test_speech.py`: 20 orders spoken by 4 macOS voices, clean and with synthetic rotor noise at 10 dB, sent through the server as the page sends them.
  - Result on an M1, 12 Nov 2026: 148/160 correct (92%) with the shipped grammar; median 0.53 s from end of audio to decision.
  - All 12 misses became questions, not wrong tactics.
  - Two confusion rules ("God the" → "guard the", "lock the door" → "block the door") were then added from those misses, so later runs of this test are optimistic.
  - Set `SPEECH_FAST=1` for a quick run.

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
