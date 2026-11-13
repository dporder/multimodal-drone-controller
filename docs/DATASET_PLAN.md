# Dataset plan: spoken orders paired with coordinated drone actions

*Dan, 12 November 2026. For review by Prat.*

## Why we synthesize it

No open dataset pairs spoken or written orders with coordinated multi-drone trajectories. We checked on 12 November 2026:
- TACOS released no data.
- DroneCATS-Pilot-54K is single-drone, single-step and non-commercial (CC BY-NC).
- The nearest permissive set, HaL-13k, covers two drones searching for a target, not tactics.

So NN1's supervised pairs come from a scripted **teacher** running in our simulators. Swarm Mind's planner already *is* a teacher: every 0.5 s it picks a template and three vectors. We log it.

## One training pair

```
input  = order (text, and optionally audio) + context window
output = template/tactic label + per drone: slot and vector (slot − position)
         [swarm-indoor adds time-stamped reference points at +0.5/+1/+1.5/+2 s and yaw]
```

The **context window** holds only what the team could know:
- estimated team state;
- the person's position if seen, otherwise the time since last seen;
- the belief summary;
- the map, from the episode header;
- goal memory: goal, version, order text.

The simulator's ground truth is logged under `truth`. It is for metrics only and is never an input.

## Record format (contract v0, gzipped JSON lines, one file per episode)

```jsonc
{"type":"header","schema":"dmc.contract.v0","sim":"swarm-mind","core_sha":"…","seed":123,
 "episode":"mind-000123","frame":"x east, z south, y up, metres",
 "doors":[{"id":0,"name":"Main door","x":24,"z":19}, …],
 "scenario":{…},                 // reset options: spawn side, intruder mode, radio loss/latency
 "orders":[{"t":0,"text":"keep him out of the building","goal":"keepout","source":"sampler",
            "parser_goal":"keepout","mismatch":false}, …]}
{"type":"plan","t":12.5,"tick":25,
 "order":{"goal":"keepout","version":1,"text":"keep him out of the building"},
 "obs":{"seen":true,"p":[19.8,0.0,27.3],"last_seen_age":0,"lambda":0.4,"orient":0},
 "team":[{"id":"M","pos":[…],"vel":[…]},{"id":"S1",…},{"id":"S2",…}],
 "label":{"template":"barrier","text":"barrier at the main door","door":0,
          "slots":[[…],[…],[…]],"vectors":[[…],[…],[…]]},
 "radio":[{"to":"S1","dropped":false,"latency":0.18},{"to":"S2",…}],
 "truth":{"intruder":{"pos":[…],"state":"approach","inside":false}}}
{"type":"outcome","t_end":180,"end":"timeout","breaches":0,"deterred":2,"in_view_pct":41,
 "radio_drops":12,"pushes":3}
```

## Pipeline

1. **Order sampler** (`voice/sampler.py`).
   - Draws a goal schedule per episode, for example "keep out" at 0 s and "track" at 60 s.
   - Phrases each goal from a grammar and paraphrase bank: radio style, vague, polite and disfluent.
   - Adds:
     - compound orders ("…, then …");
     - corrections ("no, the other door");
     - context pairs, where the same words mean different tactics (indoor);
     - refusals and queries.
   - Runs our parser on every phrasing and records its reading. The teacher executes the **sampler's** goal; a disagreement is flagged, never learned.
2. **Rollout** (`simulators/tools/generate.js`).
   - Node `worker_threads`, one vm context per worker, loading the same `sim-core` block as `headless.js`.
   - Per episode: `seed(n)`, then `world.reset(opts)` with a randomized spawn, intruder mode and radio settings, then the schedule plays.
   - `mission.onPlan` emits one record per plan tick.
3. **Audio (optional).** Synthesized voices, then room reverb (simulated from the floor plan, or OpenSLR 28 impulse responses), then rotor noise (DroneAudioSet), then a real Whisper pass. Test voices come from macOS `say` and are never released; release voices come from Kokoro-82M.
4. **Checks.**
   - Schema on every record.
   - Determinism: the same seed gives the same file hash.
   - Outcomes compared with a "hold" baseline on the same seeds.
   - A parser-mismatch report.
5. **Splits.** By layout seed and phrasing id, never by tick, because neighbouring ticks are near-duplicates.

Episodes where the person could not have been stopped are labelled "infeasible" and kept. Teacher mistakes are excluded from SFT.

## Indoor focus

Swarm Mind is a yard with one warehouse. Its person is invisible indoors and its drones pass through walls, so it supplies the pipeline and the first data, not the indoor data.

The indoor data comes from `simulators/swarm-indoor/` (milestone 2, built 12 November 2026). It follows the same conventions and contract, and adds:
- **Floor plans:** rooms, corridors, and doors 0.9–1.8 m wide. Today: a fixed office floor and our own procedural office generator. ProcTHOR-10K layouts (Apache-2.0) later.
- **Line of sight** through doors.
- **Room-level belief.**
- **The tactic library** in [`TACTICS.md`](TACTICS.md).
- **A safety validator.**

Extra indoor phrasing comes from IndoorUAV (Apache-2.0). Real indoor walking tracks come from THÖR-MAGNI (CC BY 4.0) later.

## Volumes

| Stage | Size |
|---|---|
| Swarm Mind, proving the pipeline | 1,000 episodes of 3 minutes each, about 360k plan ticks |
| First indoor SFT set | 10,000–50,000 episodes, about 1,000 distinct phrasings across about 10 goals |

Variety of layouts and phrasings matters more than tick count.

## Licensing

- **Our data:** CC BY 4.0. **Our code:** the repo's MIT license.
- Non-commercial or share-alike sources are kept out of anything released or used for a product.
- Paraphrases come from a model whose terms allow training on its outputs.
- macOS voices are for internal tests only.

## Generating data today (milestone 1, Swarm Mind)

```
voice/.venv/bin/python voice/sampler.py --episodes 200 --seed 0 --out output/dataset/run1   # order schedules + parser report
node simulators/tools/generate.js --orders output/dataset/run1/orders.jsonl --baseline     # episodes, manifest, summary
node simulators/tools/check_dataset.js output/dataset/run1                                   # every record against contract v0
```

**First run (12 November 2026, M1 MacBook):**

Size and quality:
- 200 episodes in 31 s on 7 worker threads: 24,198 plan records, 490 order events, 3 MB gzipped.
- Every record matches contract v0.
- Two runs with different worker counts give byte-identical files.

Parser agreement with the sampler's intended orders:
- 497/497 on seen phrasing templates.
- 108/108 on a sweep of the 9 held-out templates.
- Both numbers are optimistic: the grammar was fixed using this report's earlier mismatches.

Outcomes, with the same seeds also run under the hold baseline (drones on their pads):

| Goal active longest | Episodes | Breached | Left without breach | Hold baseline breached |
|---|---|---|---|---|
| keep out | 62 | 16% | 82% | 100% |
| drive out | 67 | 10% | 82% | 100% |
| track | 39 | 69% | 31% | 100% |
| hold | 32 | 84% | 16% | 100% |

These are Swarm Mind's outdoor yard and its scripted intruder. They prove the pipeline, not indoor tactics.

## Generating data today (milestone 2, indoor)

```
voice/.venv/bin/python voice/sampler.py --sim indoor --episodes 600 --seed 1 --out output/dataset/indoor1
node simulators/tools/generate.js --sim indoor --orders output/dataset/indoor1/orders.jsonl --baseline
node simulators/tools/check_dataset.js output/dataset/indoor1
node simulators/tools/quality_report.js output/dataset/indoor1   # quality gates, below; exit code 1 if a hard gate fails
node simulators/tests/indoor.test.js      # floors, line of sight, belief, no leak, records, bands, safety, determinism
```

**Scenarios** (one per episode, drawn by the sampler):

| Field | Values |
|---|---|
| Who | an intruder heading for a protected room (50%), an intruder hiding (20%), a lost visitor (30%) |
| Protected room | the lab mostly, sometimes the office, kitchen, storage or meeting room |
| Warning | an entering intruder waits 0–12 s outside before he comes in |
| Floor | random office layout (70%) or the fixed office |
| Radio | loss 0–15%, latency 0.1–0.4 s |
| Hidden person parameters | R_react, k_fear, k_flank, T_resolve, as in `docs/TACTICS.md` |

**Orders.** The first order comes in the first 3 s, then 0–3 re-orders 10–35 s apart. The first goal depends on who it is: keep out, drive out or track for an intruder, search for a hider, guide out for a visitor.
- **Slots:** a protected room, an exit, or a door or room to watch. INSARAG depth words set the search level.
- **Context pairs:** "get him out" is drive out for an intruder and guide out for a visitor.
- **Also sampled:** compound orders ("…, then …"), corrections, refusals and questions, in the same styles as milestone 1.

**Indoor plan record.** It has the milestone-1 fields plus what an indoor model needs:

```jsonc
{"type":"plan","t":12.5,"tick":25,
 "order":{"goal":"keepout","version":1,"text":"keep him out of the lab","src":"sampler","params":{"room":0},"status":"active"},
 "obs":{"seen":true,"p":[6.1,0,11.0],"v":[0.4,0,-1.1],"last_seen_age":0,"room":4,"belief_rooms":[4],"cleared":[]},
 "team":[{"id":"M","pos":[…],"vel":[…],"yaw":3.1,"room":3,"link_age":0}, …],
 "label":{"template":"block","text":"block his way to the lab door","band":"pressure","door":0,"room":0,"exit":null,
          "slots":[[…],[…],[…]],"vectors":[[…],[…],[…]],"yaw":[…],"spin":[false,false,false],
          "refs":[[[x,y,z] at +0.5 s, +1 s, +1.5 s, +2 s], …],"flags":[[],["standoff"],[]]},
 "radio":[{"to":"S1","dropped":false,"latency":0.18}, …],
 "truth":{"person":{"pos":[…],"room":4,"state":"approach","role":"intruder","alive":true},"margin":0.62}}
```

- **Header:** the floor (rooms, doors, furniture, pads), the protected room, the scenario and the order schedule.
- **Standoff band:** `label.band` names the band the teacher used: `pressure` (1.5 m; drive out, and keep out once he is at the door) or `comfort` (2.5 m). A student can learn it with the slots. Outcomes count true distances per band: never below 1.2 m in pressure, 2.0 m in comfort (`docs/TACTICS.md`, safety envelope).
- **Metric-only:** `header.person` (the hidden parameters) and `truth`, never model inputs.
- **No leak:** the person has his own random stream, so his hidden choices never shift the team's random draws. A test checks that where an unseen person hides does not change any label.

**Episodes end soon after the work is done.** Before, finished orders left long stretches of automatic hold in the labels: 22% of all ticks. Now:
- When an order finishes, the next scheduled order is brought forward to 3–5 s later, as an operator watching would. Its order event keeps the original time as `scheduled_t`.
- With no order left, the episode ends 5 s after the last one finishes, or once the drones have landed.

**Segments and training flags.** Every outcome lists one segment per order. A segment records:
- the goal and its source;
- start and end, and how it ended: `done`, `failed`, `found`, `landed`, `replaced` or `episode_end`;
- the closest any drone came to the person;
- ticks with a stuck drone;
- ticks per standoff band.

Every plan record carries `sft`, whether to train on it. It is false when its segment came within the 1.2 m floor, when a drone is stuck at that tick, when the segment is more than 20% stuck, or when it is more than 5 s into an automatic hold. Failed orders keep `sft: true`, because the person may have been impossible to stop. Filter on the segment's `end` and the outcome's `deterrable` to drop them too.

**Quality gates** (`simulators/tools/quality_report.js`). The report checks every label and writes `quality.json`. A hard gate fails the run.

| Gate | Kind | Rule |
|---|---|---|
| Vectors | hard | every vector is slot − position at plan time |
| Standoff | hard | every slot keeps the band's distance from the person's estimate (3 m in comfort with two or more slots within 4 m), unless the validator flagged a wall |
| Separation | hard | slots at least 1 m apart (0.95 m allowed for rounding) |
| Bounds | hard | slots inside the site and the altitude band |
| References | hard | timed reference points start at the drone and move at most 0.75 m per 0.5 s (plus 0.45 m slack) |
| Flight safety | hard | no episode inside the 1.2 m floor, no drone closing in on a person, no separation, wall or altitude violation |
| Training ticks | hard | no `sft` tick has a stuck drone or a drone inside 1.2 m of the person |
| Flicker | soft | a template that flips for one tick and back: under 0.5% of ticks |
| Swaps | soft | follower slots swapping: under 0.2% of ticks |
| Jitter | soft | slot movement while nothing changed: 95th percentile under 0.5 m |
| Stuck | soft | a drone that does not move for 5 s while its slot stays over 1 m away, not counting doorway queues: under 5% of drone-ticks |
| Doorway queues | soft | under 5% of drone-ticks; each drone's record now has `wait_door` |
| Hold | soft | automatic hold under 15% of ticks; hold of any kind under 25% |
| Usable | soft | over 80% of ticks fit for training |

**Why the first run's keep-out looked weak.** Of the 13 episodes scheduled with keep out as their only order:
- 12 had an intruder our model says cannot be deterred even by all three drones at 3 m;
- several defended a room with its own outside door, such as the kitchen's fire exit, where he is inside at 8 s, before a drone can arrive.

Changing the order time, the radio, the floor or the order's room name changed nothing. So the gap was in what was winnable, not in the pipeline: use `deterrable` and the segments to tell the two apart.

**First indoor run (13 November 2026, M1 MacBook), after the quality fixes:**

Size and quality:
- 600 episodes in 8 minutes on 7 worker threads, each paired with a grounded baseline on the same seed. 111,084 plan records and 1,412 order events, 18 MB gzipped.
- Before the fixes the same schedule gave 139,387 records; the difference is mostly automatic hold that no longer trails finished orders.
- The scenarios: 296 intruders heading for a room, 127 hiding, 177 lost visitors; 419 random floors and 181 on the fixed office.
- Every record matches contract v0. The same seed gives the same records (`indoor.test.js`).
- **All 13 quality gates pass.** `quality_report.js` reports:

  | Measure | Result |
  |---|---|
  | Template flicker | 0.02% of ticks |
  | Follower swaps | 0.09% |
  | Slot jitter when nothing changed, 95th percentile | 0.13 m |
  | Stuck drones | 4.6% of drone-ticks |
  | Doorway queues | 2.5% |
  | Automatic hold | 2.5% of ticks |
  | Hold, all causes | 19.5% (was 35%) |
  | Ticks fit for training (`sft`) | 81.9% |

- **Templates in the labels:** search 25,700 · hold 21,628 · track 15,746 · lead (guide out) 10,293 · explore 8,503 · overwatch 8,246 · push (drive out) 6,867 · barrier 4,614 · doors (contain) 3,925 · return 3,736 · block 1,803 · ring 23.
  - Search includes the short searches that drive out, track and contain run when they lose him.
  - The contain ring needs a room at least 7 m across, so it is rare.
- **Bands:** comfort 98,337 ticks (89%), pressure 12,747 (11%).
- **What the team knew:** at 37% of ticks the person was in sight, at 12% only an estimate from the last 4 s was known, and at 51% his position was unknown.

The orders:
- 1,535 sampled phrasings: 1,406 orders, 59 questions and 70 refusals, from 185 templates and 1,199 distinct texts.
- 77 compound orders and 39 context pairs.
- 1,412 order events reached an episode; the rest were scheduled after the person had already left.

Parser agreement with the sampler's intended orders:
- 1,501/1,501 on seen phrasing templates and 34/34 on held-out ones; 108/108 on the held-out sweep.
- These numbers are optimistic: the grammar was fixed using earlier runs of this report.

**Safety on true positions, all 600 episodes:**
- No drone came within the 1.2 m floor; the closest in the pressure band was 1.21 m.
- No drone moved toward a person inside its band's limit for more than 0.5 s.
- No separation, wall or altitude violations.
- In 70 episodes (12%) a person came within 2.0 m of a comfort-band drone that was giving way, closest 1.47 m. This happens in corridors.
- Earlier runs of this set found three floor breaches and a climb above the altitude band; the fixes are in `docs/TACTICS.md`.

**Outcomes need care.** `summary.txt` gives outcomes by first order and for the 92 episodes scheduled with a single order. They are not tactic benchmarks:
- **Re-orders:** the first order is usually replaced 10–35 s later, often before an intruder arrives, so most episodes mix tactics.
- **Single-order episodes:**
  - Keep out let in 10 of 13 intruders, and drive out 9 of 12, against 11 of 13 and 11 of 12 with the drones grounded. That is mostly what was winnable: see "Why the first run's keep-out looked weak" above.
  - Guide out got 13 of 21 visitors out (8 of 21 before the guide fixes), and search found 9 of 12 hiders.
- **Benchmarks:** use the controlled runs in `docs/TACTICS.md`, where one order is given at 1 s and kept.

## Open questions for Prat

1. Is "slot + vector every 0.5 s" the right output for NN1, or should NN1 emit time-stamped reference points, as the 10 November briefs recommend? `swarm-indoor` logs both.
2. Should NN1 see the belief map, or only a compact summary?
3. Which goals should v1 support beyond keep out, drive out, track and hold? Swarm Indoor has ten; guide out and search are the strongest teachers today.
4. Is the person model's range of "deterrability" right? It caps what keep out and drive out can achieve (`docs/TACTICS.md`).
5. For the outcome labels, should episodes keep one order long enough to finish (gaps of 30–90 s), or are frequent re-orders more useful for NN1? Today's 10–35 s gaps give many transitions but blur outcomes.
