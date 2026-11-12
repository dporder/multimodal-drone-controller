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

The indoor data comes from `simulators/swarm-indoor/` (milestone 2). It follows the same conventions and contract, and adds:
- **Floor plans:** rooms, corridors, and doors 0.9–1.8 m wide. Our own procedural generator first, then ProcTHOR-10K layouts (Apache-2.0).
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

## Open questions for Prat

1. Is "slot + vector every 0.5 s" the right output for NN1, or should NN1 emit time-stamped reference points, as the 10 November briefs recommend? `swarm-indoor` logs both.
2. Should NN1 see the belief map, or only a compact summary?
3. Which goals should v1 support beyond keep out, drive out, track and hold?
