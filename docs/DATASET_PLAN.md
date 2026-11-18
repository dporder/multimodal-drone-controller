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
- the map the drones have scanned so far; the floor plan from the episode header is an optional prior;
- goal memory: goal, version, order text.

In `swarm-indoor`, "seen" comes from simulated detections, not from geometry. See "Inputs: perception outputs, not truth" below.

The simulator's ground truth is logged under `ground_truth`. It is for metrics only and is never an input.

## Record format (contract v1, gzipped JSON lines, one file per episode)

**Contract v1 (Dan, 17 November 2026)** renamed the plan line's keys so they say what they hold. Values and everything else stayed the same:

| v0 | v1 |
|---|---|
| `obs` | `world_beliefs`: the world outside the drones as the team believes it, the person's keys grouped under `person` (`p` → `position`, `v` → `velocity`, `belief_rooms` → `possible_rooms`; `detections[].p` and `people[].p` → `position`) |
| `team` | `drone_beliefs`: each drone as it believes itself to be (`pos` → `position`, `vel` → `velocity`, `cam` → `depth_readings`) |
| `label` | `teacher_plan` |
| `truth` | `ground_truth` (`pos` → `position`) |
| `sft` | `use_for_training`, also in the outcome's `segments` |

`node simulators/tools/convert_v0_v1.js <run folder>` converts an older run in place (indoor3 was converted on 17 November). The check rejects a v0 run and names the converter. A check that runs the same episodes on the last v0 build and the first v1 build found every line identical after conversion (34 runs: doors on and off, baselines, Swarm Mind).


```jsonc
{"type":"header","schema":"dmc.contract.v1","sim":"swarm-mind","core_sha":"…","seed":123,
 "episode":"mind-000123","frame":"x east, z south, y up, metres",
 "doors":[{"id":0,"name":"Main door","x":24,"z":19}, …],
 "scenario":{…},                 // reset options: spawn side, intruder mode, radio loss/latency
 "orders":[{"t":0,"text":"keep him out of the building","goal":"keepout","source":"sampler",
            "parser_goal":"keepout","mismatch":false}, …]}
{"type":"plan","t":12.5,"tick":25,
 "order":{"goal":"keepout","version":1,"text":"keep him out of the building"},
 "world_beliefs":{"person":{"seen":true,"position":[19.8,0.0,27.3],"last_seen_age":0},"lambda":0.4,"orient":0},
 "drone_beliefs":[{"id":"M","position":[…],"velocity":[…]},{"id":"S1",…},{"id":"S2",…}],
 "teacher_plan":{"template":"barrier","text":"barrier at the main door","door":0,
          "slots":[[…],[…],[…]],"vectors":[[…],[…],[…]]},
 "radio":[{"to":"S1","dropped":false,"latency":0.18},{"to":"S2",…}],
 "ground_truth":{"intruder":{"position":[…],"state":"approach","inside":false}}}
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
- **Floor plans:** rooms, corridors, and doors 0.9–4 m wide, in eight single-level procedural families (next section). Open-source plans next: ProcTHOR-10K (Apache-2.0) and Swiss Dwellings (CC BY 4.0).
- **Line of sight** through doors.
- **Room-level belief.**
- **The tactic library** in [`TACTICS.md`](TACTICS.md).
- **A safety validator.**

Extra indoor phrasing comes from IndoorUAV (Apache-2.0). Real indoor walking tracks come from THÖR-MAGNI (CC BY 4.0) later.

## Layout families (single level)

Since 13 November the indoor simulator builds eight families of single-level floors. Each family draws its size, its room and door counts, door positions and widths, furniture and ceiling height from the episode seed. Each also has a fixed reference floor.

| Family | Rooms (mean) | Floor (mean) | What makes it different |
|---|---|---|---|
| Office (`office`) | 7: lab, office, kitchen, corridor, lobby, storage, meeting room | 347 m² | The first datasets' floor. Random offices draw exactly as before. |
| House or apartment (`house`) | 6: living room, kitchen, hallway, 1–3 bedrooms, bathroom | 164 m² | Small rooms, a hallway 1.6–2.2 m wide, beds and wardrobes, front and back doors |
| Warehouse (`warehouse`) | 3: an L-shaped hall, an office, a break room | 620 m² | Ceiling 4.5–7 m, racks up to 4 m high with 2.4–3.2 m aisles, a 3–4 m loading-dock door |
| Open-plan office (`openplan`) | 6.4: 2–4 meeting rooms, the open office, reception, kitchen | 502 m² | One large room with desk clusters, a third of them with 1.3 m privacy screens |
| School or hospital (`corridor`) | 13.8: classrooms or wards, a staff room or nurses' station, an office or storeroom, a lobby, all on one corridor | 618 m² | A 30–46 m corridor with exits at both ends |
| Shop (`retail`, held out) | 3: sales floor, storeroom, office | 497 m² | Gondolas 1.4–1.8 m high with 1.8–2.4 m aisles, checkouts |
| Single room (`single`) | 1: a hall, gym, studio, workshop or showroom | 92 m² | L-shaped 40% of the time, 1–3 outside doors, loose furniture |
| Irregular (`irregular`, held out) | 5: an L-shaped corridor, an L-shaped hall, an office, a store, a workshop | 350 m² | L-shaped rooms round a bend |

**One floor format.**
- A room is a union of axis-aligned rectangles, so L-shaped and irregular rooms work.
- A door sits on the wall between two rooms, or between a room and outside.
- Furniture is boxes with a height.
- Walls are 0.2 m thick and reach the ceiling. They run along every room boundary.
- The header's `floor` records the family, its source and licence, each room's rectangles and bounding box, the home room, and the rooms worth protecting.

**Names come from the floor.**
- `simulators/tools/floors.js` gives the sampler each episode's room, door and exit names. Orders use those names, plus synonyms the parser reads back as the same place ("lounge" for the living room, "classroom three" for classroom 3).
- The parser takes names from its context as before, and now also reads number words in numbered rooms.
- The parser chooses among synonyms by what exists on the floor: "hall" is the corridor in the office, the hallway in a house, and the hall itself on a floor that has one.

**Train/test split by family.**
- Every episode on the shop and irregular floors is a test episode, so test results measure layouts that no training episode has seen.
- The other six families keep the seed rule: seeds ending in 0 are test.
- `--held-out-families` changes the choice.

**Scenario changes.**
- The protected room is drawn from the floor's rooms worth protecting. The floor's default is four times as likely as each other room.
- A hider now hides in any room except the drones' home room. Before, he hid in the protected room.
- 15% of episodes use the family's fixed floor (30% before, office only).

**Tests per family.** `indoor.test.js` adds four tests:
- **Reachability**, on the fixed floor and 7 random floors of each family:
  - every room by air from the pads, and on foot from every exit;
  - every door passable on foot and by air;
  - pads free, and search points in every room.
- **Line of sight**, on 4 floors per family: walls between rooms block, doorways do not, and lintels block above 2 m.
- **Every order on every family:** 72 episodes of 45 s. No breach of the 1.2 m floor, no separation, wall or altitude violations, finite labels, and a sound belief.
- **Floors depend only on the seed.**

The refactor to rectangle sets was checked first against the old code. On 60 office episodes the records were byte-identical.

**Bugs found on the way.**
- **Furniture pockets.** Furniture can close off a pocket of free floor, such as behind a table or between a bed and a wall.
  - A hider sent into one made the person's path search run every frame over the whole floor. In one warehouse episode, 75 s of simulation took 300 s of compute.
  - Targets now snap out of such pockets. A failed path search waits a second before retrying. Search coverage counts only floor a person can reach.
- **Stale search vantage.** The search's hub-vantage cache survived into the next episode on the same worker, so a new floor could reuse a point from the previous one. It is now cleared with every order.
- **Hard gates on the new floors.** The first full run failed three hard gates once each, and the rerun one more. Each was replayed, fixed in the teacher and regenerated:
  - **Separation against standoff in a cramped corner** (open-plan reception). The validator's last standoff pass left two slots 0.9 m apart. The rotation and standoff passes now alternate until both hold.
  - **A pinned drone pushed toward a person.** Wall repulsion carried a drone pinned against a wall toward a person running past, for 0.55 s (irregular floor). The flight layer now never moves a drone toward a person in sight inside its band's limit + 0.3 m.
  - **Keep-out shut a drone in with the intruder** (warehouse office).
    - Its block slots retreated into a small protected room ahead of the intruder. Once he was through, the drone was cornered.
    - It climbed to 4.4 m, but he stood 1.19 m from it (horizontally) for 3 s.
    - Block slots in rooms under 40 m² now flank the door from outside.
  - **Drive-out deadlock at a house's front door.**
    - Two drones stood inside the front door, which the intruder wanted to leave by, and he stood 1.15 m from them for two minutes.
    - In the 1.7 m hallway they could not get behind him.
    - Drive out now avoids an exit where our drones stand between him and the door. A leaving person avoids exits with drones at them and chooses again after 3 s blocked.
    - Over 40 controlled office runs, drive out let in 19 intruders, against 21 before.
- **Known weakness: houses.**
  - 8.7% of drone-ticks are stuck (other families 1.5–4.6%), mostly in the hallway, which every room opens onto and only one drone can fly along at a time. Training flags exclude those ticks, so houses keep 71% of ticks for training, against 83–95% elsewhere.
  - Fixing it needs traffic rules for narrow passages, or tactics that send fewer drones into them.

**Open-source floor plans.** Licences were checked on 13 November 2026 from the licence pages, READMEs and terms. Nothing has been downloaded.

| Dataset | Licence | Use it? |
|---|---|---|
| ProcTHOR-10K (AI2) | Apache-2.0, data and code | **Yes.** 10,000 houses as vector JSON: room polygons, doors on walls, objects. 63 MB gzipped. Object sizes come from AI2's `asset-database.json` (Apache-2.0). |
| Swiss Dwellings v3.0.0 (Archilyse, Zenodo) | CC BY 4.0 | **Yes, with attribution.** Vector rooms, walls, doors and fixtures in metres, but no movable furniture. 932 MB zip. |
| MSD (TU Delft, built from Swiss Dwellings) | CC BY 4.0 on 4TU; CC BY-SA 4.0 on Kaggle | Possible from 4TU. Swiss Dwellings is the vector source. |
| Structured3D | Non-commercial terms, no redistribution | No |
| RPLAN | Non-commercial terms, no redistribution; raster images only | No |
| CubiCasa5K | CC BY-NC 4.0 (GitHub), CC BY-NC-SA 4.0 (Zenodo) | No |
| HouseExpo | MIT, but built on SUNCG (Planner 5D) content | No: provenance |
| Gibson, Matterport3D, HM3D | Academic-only EULAs; models trained on the data count as derived data | No |

Next steps:
1. A ProcTHOR-10K converter. Its rooms are rectilinear polygons, which split into rectangles. Doors come from wall holes, and furniture boxes from object positions and asset sizes. Each converted floor keeps `source: procthor-10k` and `licence: Apache-2.0` in its header.
2. Swiss Dwellings, which needs about 1 GB of free disk.
3. Multi-level floors (stairs, a mezzanine, an atrium), later.

## The full dataset: one master log, rendered frames, training cuts (plan approved by Dan, 13 November 2026)

Dan's goal: "build a dataset that includes camera frames and really everything all together. We can then break it up however we want for training." Three layers:

1. **The master episode log is the canonical copy.** It holds everything the simulator knows, so any episode can be replayed exactly:
   - the seed, the core version (`core_sha`), the scenario and the orders;
   - the layout;
   - labels, detections and the scanned map, as in contract v1;
   - full 3-D poses at a high rate: each drone's position, velocity and attitude, with the camera's height, yaw and pitch; and every person's position, heading, posture and attributes.

   Contract v0 grows a pose track for this: one `poses` record per second holding 30 Hz samples. That adds an estimated 0.2–0.3 MB per episode gzipped, so 10,000 episodes come to about 3 GB.
2. **Frames are a derived layer, rendered by replaying the log.**
   - Per drone camera: RGB, depth, segmentation, and person bounding boxes.
   - Frames can be re-rendered at any resolution or camera model without simulating again.
   - The simulation run does not write frames. At 640×480 RGB plus depth, from 3 drones at 10 Hz, an episode (88 s on average today) is about 0.5–1 GB. 10,000 episodes would be 5–10 TB.
3. **Training sets are cuts across the layers.** Labels are identical in every cut.

   | Cut | Inputs | Use |
   |---|---|---|
   | NN1 on perception outputs | detections, scanned map, coverage, camera rays, order, team state (contract v1 today) | the planner |
   | Detector | frames with person boxes | train a real detector; compare its hit and false-positive rates with the simulated detector's |
   | End-to-end | frames, order, team state | later |
   | Held-out layouts | any of the above, split by floor family | generalization |

**Renderer.**
- Habitat-sim (MIT) or AI2-THOR (Apache-2.0). Both are open source, both have Mac builds, and both load ProcTHOR scenes, which ties in with the layout work.
- Isaac Sim only if needed later: it needs an RTX GPU.
- **People must appear in frames:** Habitat 3.0 humanoids or an equivalent, with varied body shapes and clothing (see "Diverse people").
- **Our procedural families need 3-D versions**, ideally converted to the ProcTHOR / AI2-THOR scene format: walls from room rectangles, door openings, and furniture boxes mapped to assets.
- **Licences:**
  - **Confirmed 13 November:** Habitat 3.0's humanoids (CC BY-NC 4.0, built on SMPL-X) and SMPL-X itself (non-commercial; also bans military and surveillance use) cannot be used. MakeHuman exports can.
  - **Still to check:** AI2-THOR's 3-D assets may carry terms separate from its code.
- **Later:** run a real detector on the frames and compare it with the simulated detector's rates.
- **Practical notes:**
  - The Mac builds render in a window. Headless rendering on VMs uses the Linux builds (EGL for Habitat-sim, CloudRendering for AI2-THOR), hence one container image for both.
  - The Mac pilot needs 25–50 GB of free disk at full size (about 5 GB was free on 13 November). Either free space or an external drive, or render the pilot at reduced size and extrapolate.

**Azure scale-out (pending Dan's approval; no resources are created and nothing is spent before his explicit yes).** The proposal is written from the pilot's measured GB and render time per episode. It will cover:
- **Container:** one image, the same on the Mac and the VMs.
- **Jobs:** a queue with one episode log per job.
- **Storage:** frames to Blob Storage in the same region.
- **Compute:** spot GPU VMs (NCasT4_v3 for Habitat or THOR; NVadsA10_v5 if Isaac) in a pool that scales to zero.
- **Training:** near the data.
- **Numbers:** VM size and count, the estimated cost at prices checked on the day, and the runtime.

## Diverse people (approved by Dan, 13 November 2026; items 1–4 built the same day)

Before this, every episode had exactly one person: a point that followed a smooth shortest path, with fixed speeds (walk 1.2 m/s, run 2.0, visitor 0.9) and a fixed height.

1. **Bodies (built).** Each person has an age, a sex, a height, a shoulder width and a collision radius. Visitors include children (15%) and people 65 or over (20%).
   - **Stature:** adults from CDC NHANES 2015–18 (men 1.753 ± 0.074 m, women 1.613 ± 0.069 m; Fryar et al. 2021, public domain). Children by age, consistent with the CDC references.
   - **Shoulder width:** from ANSUR II (Gordon et al. 2014, cleared for public release).
   - **Mobility aids:**
     - Wheelchair: 0.65 m wide (Steinfeld et al. 2010), 0.8–1.15 m/s (Tolerico et al. 2007; Gales et al. 2020).
     - Cane: 0.65–1.1 m/s, about 0.9 on average (Gales et al. 2020).
     - Pushchair.
   - **Postures:** standing, crouching, sitting and lying. They set the three body points a camera must see and the target's apparent size, which shortens the detection range for small or low people.
   - **Collisions:** wheelchairs and pushchairs walk on a wider grid (0.4 m clear of obstacles), with doorways opened along their centre line.
   - **Guide-out:** the guide's pace already follows the visitor.
2. **Speeds (built).**
   - **Walking:** comfortable speed by age and sex from Bohannon & Andrews 2011 (1.36–1.43 m/s for adults, 0.94–0.97 over 80), with an SD of 0.16 after Bohannon 1997. Speeds drift ±10% within an episode.
   - **Running and sprinting:** 3.0–4.2 m/s running and 4.8–6.4 m/s sprinting for 16–40-year-olds, less with age. This is **our assumption**: no large normative study of ordinary adults exists, and people switch from walking to running near 2 m/s (Rotstein et al. 2005).
   - **Intruders:** when fleeing or leaving, they run, many with sprint bursts of 2–6 s.
   - **Drones are slower:** the drones (1.5 m/s, 2.5 m/s to get clear of someone) cannot keep up with a sprinter, so results are reported separately for people who ran.
   - **Belief:** the team's belief now assumes the person may run at 4.5 m/s.
3. **Movement patterns (built).**
   - stop-and-go pauses;
   - hesitating at doorways;
   - doubling back a few metres;
   - dodging while a drone presses them;
   - sprint bursts;
   - wall-hugging;
   - hiding while crouching, sitting or lying, and crawling away when a drone comes close.

   Each person draws their own mix.
   - **Tuning against real tracks is pending.** Of the open trajectory sets, only THÖR and THÖR-MAGNI (CC BY 4.0, open on Zenodo, about 0.5 GB and 1.1 GB of tracks) can be used commercially. ETH and ATC are research-only, UCY has only a credit-only notice and no licence, and JRDB is non-commercial. Downloading THÖR needs Dan's approval.
4. **Several people (built).**
   - **The cast:** staff, and visitors alone or in groups of two or three, in numbers that depend on the floor family (0–6). Staff wear a uniform where the family has one (hi-vis vest, uniform, staff shirt). Everyone else has clothes drawn per person.
   - **Movement:** they walk between rooms, pause and sit, keep about 2.5 m from drones, and wait while one hovers ahead of them. After 3 s of waiting, or of getting nowhere, they pick somewhere else to go.
   - **Tracks:** the detector sees everyone and reports a track id per person, with occasional identity switches between people within 1.5 m. A false positive near the target is sometimes taken for the target's track.
   - **Fusion:** the team builds its estimate from its target's track only. Other people the team has placed go into `world_beliefs.people`, and slots keep the comfort standoff from them too.
   - **Safety for everyone:** the 1.2 m floor and the onboard safety layer apply to every person, measured on true positions. A drone senses a person if a line reaches their torso or their legs, so a door lintel cannot hide someone from a drone flying high. It never moves toward anyone it saw in the last 10 s who is still within 4.5 m but out of sight, as an onboard tracker keeps a person who stepped behind a shelf or a door jamb.
   - **Orders can describe the person:** "keep the man in the red coat out of the lab", "track the woman with the cane". The parser matches the description against the people on the floor and adds `params.person`, or asks which person when several fit or nobody does. The sampler writes unique descriptions (70% of first orders when others are present) and ambiguous ones (10%), answered with a question and then a clarifying order.
   - **Truth logs everyone.** Observations hold only detections.
5. **Appearance (render layer, with the frames pilot).**
   - Skin tone is already drawn per person on the 10-point Monk scale, with clothes, hats, bags, masks and glasses, for the renderer.
   - **Body-model licences:**
     - **MakeHuman:** its bundled assets are CC0 and it claims nothing over exports, so it is usable.
     - **SMPL-X:** non-commercial, and it explicitly bans military and surveillance use and training networks for commercial use. Do not use it.
     - **Habitat 3.0 humanoids:** CC BY-NC 4.0 and built on SMPL-X. Do not use them.
6. **Results by group (built in the quality report).** Episodes are split by age, height, mobility aid, posture, whether the person ran, skin tone and the number of other people. The simulated detector does not model skin tone, so that split stays flat until a real detector runs on rendered frames.

Every person attribute is logged as metric-only: the cast in the header, and posture and speed in `ground_truth`.

## Perception realism and flyable route labels (approved by Dan, 13 November 2026; built the same day)

- **Sharing over the radio.**
  - The master's own detections count at once.
  - A follower's detections, map updates and coverage marks reach the master with the episode's radio latency and loss (`world_beliefs.detections[].age` says how old each detection is).
- **Odometry drift.**
  - Each drone's position estimate wanders by 0.5–2% of the distance flown (drawn per episode), in a slowly turning direction, plus a heading drift of up to ±0.5°/min.
  - It re-localizes near the home pads.
  - **What uses which pose:**
    - Drones navigate and place their detections, depth rays and coverage from the estimate.
    - Flight, collisions and safety use the true pose.
    - The teacher plans from the estimates.
  - **Records:** `drone_beliefs[].position` is the estimate, and `ground_truth.drones` the true pose.
- **Depth.**
  - Stereo-like noise of (0.01 + 0.006 r²) m × a per-episode factor (0.7–1.5; ×3 in single-camera mode).
  - 1–5% missing returns.
  - Up to 15% of wall stretches that are glass, mirror or blank, where 70% of returns go missing.
  - Camera rays record a missing return as `null`.
- **Lighting and blur.**
  - Each room is lit, dim or dark this episode (60/30/10%), scaling the hit rate (×1, ×0.75, ×0.45).
  - The hit rate falls while a drone turns faster than 60°/s.
- **Bookkeeping:** the episode's noise is recorded in the header's `perception` block. It draws from its own seeded stream, with a fixed number of draws per step, so determinism and the no-leak test hold.
- **Route labels (`refs`) are flyable.**
  - They are generated by running the flight law forward from each drone's current position and velocity, with at most 2 m/s² of acceleration and the band's speed limit.
  - Before this, they assumed full speed from a standstill: a drone at rest was labelled 0.75 m away after 0.5 s, against 0.25 m it can actually fly.
  - Quality gate 5 now checks acceleration, speed and climb.
  - The report gives refs against the actual flight: on the office-only set, the old refs were off by 2.28 m (95th percentile at +2 s), and the new ones by 0.8 m.

## Work queue (13 November 2026; updated 17 November)

1. **Before the big indoor run:**
   1. Single-level layouts. The eight procedural families are done. A ProcTHOR-10K converter is next, once Dan approves the download.
   2. Done: route labels (refs) that respect acceleration and the drone's current velocity.
   3. Done: perception realism (detections, map and coverage shared over the lossy radio; pose drift; depth noise; lighting and motion blur).
   4. Done: diverse people 1–4 (bodies, speeds, movement patterns, several people). Tuning movement against THÖR tracks is next, once Dan approves the download.
   5. Found by the 1,200-episode run (see "People and realism run"):
      - Keep out and drive out against runners: the drones no longer stop intruders who run, so rework the tactics (for example, pre-position at doors early), or have a practitioner check how many intruders really run.
      - The subject needs the bystanders' give-up rule, and its recorded velocity should be the step it made. A wandering visitor and a pinned drone held each other for 84 s. Done with doors on (17 November); doors off keeps the old behaviour, so its records stay identical.
      - Drones should slow near open leaves and doorways, where someone may be hidden (surprises at doors, found by the door pilot).
      - Bystanders creeping up on a drone (found by the door pilot): fixed with doors on; doors off still has it, kept for identical records.
      - Doors off also keeps the old wall-slide tolerance and the old floor split; the doors-on versions should replace them once doors-off records no longer need to match indoor3.
      - Odometry drift in narrow doorways (found by the door pilot): a drone whose estimate has drifted about 0.85 m plans as if it were elsewhere, and can stay stuck at a 0.9 m doorway for several seconds; an open leaf beside the doorway makes the passage longer. Drones re-localize only near their pads today; doorways are good visual landmarks to re-localize at.
   6. Done (17 November): doors in the POC, closed, half-open, open and locked, opened and closed by people (see "Things that move besides people and drones"). Next: regenerate the 1,200-episode set with doors.
2. **The full dataset, after the layout work:**
   1. Master-log replay with full 3-D poses, plus a determinism test (replay gives the same poses).
   2. A pilot on Dan's Mac: about 50 episodes rendered locally, with diverse appearance (people item 5).
      - Check that frames line up with the log: the person's true position, projected into the frame, must fall inside the box.
      - Measure GB and render time per episode.
   3. The Azure scale-out proposal, for Dan's approval.
3. Done: **results by group** (people item 6) in the quality report; the frames phase adds appearance to it.

## Things that move besides people and drones (plan, 17 November 2026; doors built the same day)

Only people, drones and doors move. Dan's direction (17 November): the POC can keep everything else still, but a plan for moving things should be ready.

**Doors come first.** A closed door is a wall to a drone and to its camera, and people open and close doors all the time as they move through a building. Doors are also where the tactics act:
- keep out guards the protected room's door, and an intruder opening it is the moment that counts;
- search and mapping stop at a closed door;
- someone who shuts a door behind them breaks a track;
- drive-out and guide-out routes depend on which doors are open.

**Built for the POC (Dan's decision, 17 November 2026): doors with a position but no physics, including half-open doors.** `settings.doors` is `'mixed'` by default; `'none'` gives the doorless world exactly as before (the same records, byte for byte); `'open'` and `'closed'` set every door.
- **A door is a leaf on a hinge.**
  - A doorway up to 1.25 m wide has one leaf; a wider one has two, one at each jamb.
  - The leaf is hinged on the wall face of its swing side. 0° is shut and 90° stands square to the wall.
  - The leaf is a 2 m tall panel in the height grid. Sight, depth, coverage, drone clearance and the wall gates all treat it as a wall, so a person can hide behind a half-open door.
- **Swing side:**
  - From a corridor or lobby, a door swings into the room. Exits swing outward. Otherwise it swings into the smaller room.
  - An archway (the house's kitchen opening) has no door. A loading dock's roller shutter stays up for now. Both are recorded as openings.
- **Swing check.** Each episode checks the doors with every leaf open. A door whose open leaf would cut off part of the floor (furniture just in front of it, a narrow hallway) or cover a drone pad swings the other way or on its other jamb, and failing that becomes an opening. The pilot found a reception double door that sealed the drones' take-off room. 16 of 492 doorways across the eight families end up as openings.
- **Starting states (our assumption, to be checked):**
  - 40% shut, 20% half open (15–70°), 40% open.
  - Exits start shut. The drones' home room door starts open.
  - 15% of shut doors to a room with one door, that no one is in or heading for, are locked.
  - A locked door stays shut all episode: no one has a key yet.
- **People open doors.** A person opens any door under 80° that their way goes through, swinging it at 120°/s (half that with a mobility aid). If the leaf swings toward them, they first step clear of it: past the latch-side jamb, past the hinge side, or straight back.
- **People walk round open leaves.** They plan on a walking grid that adds 0.35 m round every leaf standing 30° or more open (0.5 m with a wheelchair or pushchair).
- **Bystanders wait properly (with doors on):** a bystander waiting for a drone ahead within 1.7 m keeps the heading they mean to walk. Before, their velocity was zeroed by the wait, so they stepped on every other frame and crept up on the drone at half speed, which once put a drone at 1.19 m from one. Doors off keeps the old behaviour (queued, below).
- **The subject's give-up rule (with doors on):** like the bystanders, the subject gives up a target after 3 s of getting nowhere while no drone is pressing them, and their recorded velocity is the step they made. Doors off keeps the old behaviour, so its records stay identical. The pilot found grounded intruders stuck for the whole episode beside an open leaf at a narrow doorway.
- **People close doors behind them sometimes (assumed rates):**
  - Someone hiding: 70% for the room they hide in.
  - An intruder: 25%, or 15% when leaving.
  - Staff: 40%. Visitors: 30%.
  - Nobody closes a door that would cut the airborne drones apart, or with no room to stand clear of it.
- **Drones never touch doors.**
  - A moving leaf stops while it would come within 0.45 m of a drone; its mover gives up after 4 s. If a drone blocked it, the mover steps back up to 3 m for 6 s, so a drone boxed in against the wall can leave (a visitor and a guide once held each other at a shut exit for 130 s).
  - The drones plan from the door states they have seen. A door they have not seen counts as open.
  - A drone sees a door with its camera, or within 1.5 m.
  - A half-open door never leaves a drone a way through. Drones pass a door at 75° or more.
  - A doorway they believe they cannot fly through is blocked in their planning grid, not only its leaf.
- **The teacher's rules** are in `docs/TACTICS.md` under "Doors":
  - wait beside a shut door, or take another way;
  - a drone cut off by shut doors holds;
  - search reports rooms behind shut doors and then watches their doors;
  - in guide out, the visitor goes through a shut door the guide waits beside.
- **Records:**
  - The header gives each door's kind, hinge, swing side, leaves and leaf length.
  - `world_beliefs.doors` holds what the drones believe: the angle and its age, or null if unseen.
  - `ground_truth.doors` holds the angle and whether the door is locked.
  - The quality report adds a hard gate (no drone through a door that stayed shut) and soft gates: people inside a leaf, drones waiting beside a shut door, drones cut off, and surprises (below).
- **Surprises: an open leaf hides people.**
  - A drone passing an open door can see someone standing behind its leaf for the first time already inside 1.2 m. The pilot had one: a bystander behind the lobby door, first seen at 1.20 m, and the drone turned away within a frame.
  - With doors on, such a first sight is counted apart (`floor_surprise_s` in the outcome; a soft gate in the quality report), not as the drone's doing. From that sight on the drone's reaction counts as usual, so the hard 1.2 m gate still catches a drone that keeps closing in.
  - With doors off there were none in 1,200 episodes: doors bring this risk. Slowing near open leaves and doorways is queued below.
- **Safety layer and metrics with doors on** (doors off keeps the old behaviour, so its records stay identical; both are queued for doors off):
  - A wall slide may close on someone at up to 0.05 m/s, the floor gate's own threshold for moving toward a person. At 0.02 m/s a drone holding a doorway froze 1.1 m from an intruder standing 4° off straight ahead.
  - The 1.2 m floor is split by the gate's own words. The drone's doing is moving toward the person, or both standing still while it could back away. A drone escaping sideways or away from someone who walked up to it is not.
- **Simplifications:**
  - Doors open to 90° at most.
  - A person walks round an open leaf in their way instead of pushing it shut.
  - Shutters, self-closing fire doors and staff keys come later.

**Pilot, 17 November (60 episodes, the first 60 of indoor3's schedule), against the same 60 with doors off:**
- **Every quality gate passes.** No drone got through a door that stayed shut. No one was inside a leaf. Drones waited beside shut doors 0.8% of drone-ticks and were cut off 0.01%. One surprise and one person-caused close call fell within the soft limits.
- **Doors moved:** at the start 246 doorways were shut, 44 half open, 166 open, 5 locked and 19 openings. People opened doors 221 times and closed them 105 times.
- **Stuck drones 0.78% of drone-ticks (0.71% with doors off); training-ready ticks 95.8% (95%).**
- **Outcomes, doors on against doors off:**
  - Intruders got in 22 of 27 times with the drones flying (26 of 27 without doors) and 25 of 27 with them grounded (25 of 27).
  - Drive out stopped 3 of 6 (0 of 6). Keep out stopped 1 of 9 (0 of 9).
  - Hiders found 4 of 8, and visitors guided out 5 of 13, the same as without doors.
  - The subject was in view 21.8% of the time (23.9%).
  - 60 episodes is a small sample; the 1,200-episode run will say more.
- **Found and fixed on the way:**
  - A reception double door whose open leaves sealed the drones' take-off room (the swing check).
  - People swept behind a leaf they were opening (they now stand clear first).
  - Intruders stuck all episode beside an open leaf at a narrow doorway (planning on the leaf grid, the give-up rule).
  - A bystander creeping up on a drone.
  - A leaf swung under a drone that had climbed out of reach.
  - The person's door state carrying over to the next episode in a worker.

**Full run `indoor4`, 17 November (1,200 episodes on indoor3's schedule, contract v1), against indoor3 without doors:**
- **Every quality gate passes,** with the limit for person-caused close calls that Dan set for doors on 17 November.
  - Every record matches contract v1, and all 25 indoor tests pass.
  - No drone came within 1.2 m of anyone by its own doing, and none got through a door that stayed shut.
  - Close calls caused by people: 16 episodes, within the doors limit of 18 (1.5%); 12 without doors, against 12 (1%). In those, someone ran at a drone or walked up to one that had no room to back away: in a doorway, holding a door, or at a shut exit. Their time inside 1.2 m came to 52 s in all (112 s without doors), 38 s of it one intruder pressing a drone that held a door. These ticks are already kept out of training.
  - Seven episodes had a surprise, someone hidden behind a door or a corner first seen inside 1.2 m: 0.45 s in all.
- **Doors moved:** at the start 4,870 doorways were shut, 850 half open, 3,198 open, 118 locked and 290 openings. People opened doors 4,566 times and closed them 2,363 times.
- **The data:**
  - Stuck drones 0.70% of drone-ticks (0.75% without doors).
  - Ticks fit for training 94.7% (95.0%).
  - Drones waited beside a shut door 1.4% of drone-ticks and were cut off 0.42%.
  - 212,946 plan lines; episodes average 91.4 s (85.1 s without doors). The run took 48 minutes on the Mac.
- **Outcomes, doors on against doors off.** "Deterrable" intruders are those whose randomly drawn reaction to drones lets drones at the standoff stop them: 170 of the 606 here.
  - Intruders got in 500 of 606 times with the drones flying (533 without doors) and 526 times with them grounded (532). With doors, flying drones beat grounded ones by 4 points; without doors, by none.
  - Deterrable intruders kept out: 44 of 170 (30 of 170). Keep out stopped 23 of 58 of them (15 of 58), drive out 9 of 33 (4 of 33).
  - Hiders found: 93 of 230 (104 of 230). The drones cannot search rooms behind shut doors.
  - Visitors guided out: 134 of 364, the same as without doors.
  - The subject was in view 17.4% of the time (19.7%).
- **Found and fixed between the full runs** (the rules are in `docs/TACTICS.md`, "Doors"):
  1. **First run, four gates failed.** Fixes:
     - doorways the drones believe they cannot fly through are blocked in their planning grid;
     - the door wait is placed once, before the standoff pass;
     - wait points are clear of people using the door;
     - guides stand inside shut exits;
     - the wall-slide and floor-split rules above.
  2. **Second run, two hard gates failed.**
     - The door step's fallback undid the standoff for 77 slots.
     - A visitor and a guide held each other at a shut exit for up to 130 s.
  3. **Third run, one hard gate failed.**
     - A person's step-back from a door carried into the next episode in a generator worker, so one episode differed from its own replay, and a drone was counted through a shut door there.
     - A test now checks that a person's door state never carries over.
- **Decided (Dan, 17 November): the person-caused close-call gate allows 1.5% of episodes with doors** (1% without). These close calls are the person's doing and stay out of training. Keeping drones from hovering in doorways and recesses near people was the other option; it was not chosen.

**Later, roughly in order of how much it changes what a drone can do or see:**
1. **More door types:** automatic sliding doors, fire doors that swing shut on their own, roller shutters in warehouses, doors propped open.
2. **Lights** switched on or off during an episode. Rooms are lit, dim or dark today, but fixed for the episode.
3. **Furniture people move:** chairs pushed back, carts, a table dragged against a door as a barricade, things knocked over by someone running.
4. **Machines:** forklifts and pallet jacks in warehouses, cleaning robots, lifts.
5. **Pets,** which the person detector must not take for people.
6. **Search-and-rescue conditions:** smoke, dust and debris.
7. **The drones' own effects:** rotor wash moving paper and curtains, and hazards such as ceiling fans.

**For rendered frames:** the master log records door states and object poses every tick. Moving things are rendered as separate objects over the static room. World Labs Atlas paints only static scenes, so it can supply the room but not the motion (tested 16 November; `output/atlas_pilot/RESULTS.md`).

## Volumes

| Stage | Size |
|---|---|
| Swarm Mind, proving the pipeline | 1,000 episodes of 3 minutes each, about 360k plan ticks |
| First indoor SFT set | 10,000–50,000 episodes, about 1,000 distinct phrasings across about 10 goals |
| Master logs with 30 Hz poses | about 0.3 MB per episode, so about 3 GB for 10,000 episodes (estimate) |
| Rendered frames, 640×480 RGB + depth, 3 drones at 10 Hz | about 0.5–1 GB per episode, so 5–10 TB for 10,000 episodes (estimate; the pilot will measure it) |

Variety of layouts and phrasings matters more than tick count.

## Licensing

- **Our data:** CC BY 4.0. **Our code:** the repo's MIT license.
- **Floor plans:** procedural (ours, MIT) today. Every episode header records its floor's source and licence; open-source plans are limited to the licence-clean sets in "Layout families".
- Non-commercial or share-alike sources are kept out of anything released or used for a product.
- Paraphrases come from a model whose terms allow training on its outputs.
- macOS voices are for internal tests only.

## Generating data today (milestone 1, Swarm Mind)

```
voice/.venv/bin/python voice/sampler.py --episodes 200 --seed 0 --out output/dataset/run1   # order schedules + parser report
node simulators/tools/generate.js --orders output/dataset/run1/orders.jsonl --baseline     # episodes, manifest, summary
node simulators/tools/check_dataset.js output/dataset/run1                                   # every record against the contract (v1; convert older runs first)
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
voice/.venv/bin/python voice/sampler.py --sim indoor --episodes 1200 --seed 0 --out output/dataset/indoor3
node simulators/tools/generate.js --sim indoor --orders output/dataset/indoor3/orders.jsonl --baseline
node simulators/tools/check_dataset.js output/dataset/indoor3
node simulators/tools/quality_report.js output/dataset/indoor3   # quality gates, below, overall, per floor family and by who the subject is; exit code 1 if a hard gate fails
node simulators/tests/indoor.test.js      # floors, line of sight, belief, no leak, records, bands, safety, determinism, every floor family
```

**Scenarios** (one per episode, drawn by the sampler):

| Field | Values |
|---|---|
| Who | an intruder heading for a protected room (50%), an intruder hiding (20%), a lost visitor (30%) |
| Floor family | the eight families equally often; shop and irregular floors are test only |
| Protected room | the floor's default (the lab in the office) four times as often as each other room worth protecting |
| Hider | hides in any room but the drones' home room |
| Warning | an entering intruder waits 0–12 s outside before he comes in |
| Floor | a random floor of the family (85%) or its fixed floor |
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
 "world_beliefs":{"person":{"seen":true,"position":[6.1,0,11.0],"velocity":[0.4,0,-1.1],"last_seen_age":0,"room":4,"possible_rooms":[4]},"cleared":[],
        "detections":[{"drone":"S1","position":[6.07,0,10.93],"conf":0.91}, …],"coverage":[0,0,0,0,0.42,0,0],"map":"??..##..??…"},
 "drone_beliefs":[{"id":"M","position":[…],"velocity":[…],"yaw":3.1,"room":3,"link_age":0,"wait_door":null,"depth_readings":[4.5,4.4,…]}, …],
 "teacher_plan":{"template":"block","text":"block his way to the lab door","band":"pressure","door":0,"room":0,"exit":null,
          "slots":[[…],[…],[…]],"vectors":[[…],[…],[…]],"yaw":[…],"spin":[false,false,false],
          "refs":[[[x,y,z] at +0.5 s, +1 s, +1.5 s, +2 s], …],"flags":[[],["standoff"],[]]},
 "radio":[{"to":"S1","dropped":false,"latency":0.18}, …],
 "ground_truth":{"person":{"position":[…],"room":4,"state":"approach","role":"intruder","alive":true},"margin":0.62,
          "detections_tp":[true, …],"estimate_from_fp":false},
 "use_for_training":true}
```

- **Header:** the floor (rooms, doors, furniture, pads), the protected room, the scenario and the order schedule.
- **Standoff band:** `teacher_plan.band` names the band the teacher used: `pressure` (1.5 m; drive out, and keep out once he is at the door) or `comfort` (2.5 m). A student can learn it with the slots. Outcomes count true distances per band: never below 1.2 m in pressure, 2.0 m in comfort (`docs/TACTICS.md`, safety envelope).
- **Metric-only:** `header.person` (the hidden parameters) and `ground_truth`, never model inputs.
- **No leak:** the person has his own random stream, so his hidden choices never shift the team's random draws. A test checks that where an unseen person hides does not change any label.

**Inputs: perception outputs, not truth.** NN1 is meant to consume what an on-board perception stack outputs: person detections and a map. It does not take raw camera frames.
- **Out of scope here:** rendering images and depth (Isaac Sim, AirSim, or Habitat with ProcTHOR scenes) and training the detector belong to a separate perception and sim-to-real workstream. That workstream produces these same outputs from pixels.
- **Detections** (`world_beliefs.detections`): each drone's camera runs a simulated person detector at 10 Hz.
  - **Hit rate:** it falls with distance (97% within 3 m, 35% at the 8 m range), toward the edge of the 90° view (×0.6 at the edge), and with occlusion (the share of head, chest and hip the camera can see; lower when he is crouched hiding). Measured per frame: 96% at 2 m, 84% at 4 m, 54% at 6.5 m, 37% at 7.8 m, and 72% at 40° off axis.
  - **Errors:** position noise grows with distance (0.17 m mean error at 2 m, 0.40 m at 7.8 m). Each detection has a confidence. About 0.1% of frames add a false positive somewhere on open floor in the cone, mostly with low confidence.
  - **Use:** the record keeps every detection from each camera's latest frame. `ground_truth.detections_tp` says which were the person.
- **Seen and the estimate:** a detection counts when its confidence is at least 0.5. The estimate is the most confident detection, averaged with others within 1.5 m. `world_beliefs.person.seen`, `.position` and `.velocity` come only from these; the estimate is held for 4 s after the last sighting. `ground_truth.estimate_from_fp` marks estimates that came from a false positive.
- **Scanned map** (`world_beliefs.map`): depth rays (90°, 5 m) build a map in every episode, not only while exploring.
  - **Format:** cells of 0.6 m, `#` known blocked, `.` known free, `?` unknown, row-major in x then z. Size and legend are in `header.map`.
  - **Other fields:** `world_beliefs.coverage` gives each room's search coverage (it counts during searches only), and `drone_beliefs[i].depth_readings` gives 31 ray lengths across each camera's view, which is what that camera can see.
- **Floor plan:** the header's floor plan is a prior map (`header.floor_role = prior_map_optional`). Use it as an input only if real deployments will have floor plans; otherwise train map-free on `world_beliefs.map`.
- **Still idealized:**
  - **The teacher plans on the full floor plan.** It is a privileged teacher, so a map-free student sees less than its teacher did.
  - **The drones' close-range back-away reflex** uses the person's true position within 4.5 m in line of sight, standing in for a short-range proximity sensor.
  - **Door contact sensors** are exact.

**Episodes end soon after the work is done.** Before, finished orders left long stretches of automatic hold in the labels: 22% of all ticks. Now:
- When an order finishes, the next scheduled order is brought forward to 3–5 s later, as an operator watching would. Its order event keeps the original time as `scheduled_t`.
- With no order left, the episode ends 5 s after the last one finishes, or once the drones have landed.

**Segments and training flags.** Every outcome lists one segment per order. A segment records:
- the goal and its source;
- start and end, and how it ended: `done`, `failed`, `found`, `landed`, `replaced` or `episode_end`;
- the closest any drone came to the person;
- ticks with a stuck drone;
- ticks per standoff band.

Every plan record carries `use_for_training`, whether to train on it. It is false when its segment came within the 1.2 m floor, when a drone is stuck at that tick, when the segment is more than 20% stuck, or when it is more than 5 s into an automatic hold. Failed orders keep `sft: true`, because the person may have been impossible to stop. Filter on the segment's `end` and the outcome's `deterrable` to drop them too.

**Quality gates** (`simulators/tools/quality_report.js`). The report checks every label and writes `quality.json`. A hard gate fails the run.

| Gate | Kind | Rule |
|---|---|---|
| Vectors | hard | every vector is slot − position at plan time |
| Standoff | hard | every slot keeps the band's distance from the person's estimate (3 m in comfort with two or more slots within 4 m), unless the validator flagged a wall |
| Separation | hard | slots at least 1 m apart (0.95 m allowed for rounding); in a cramped corner the validator moves one slot to the nearest point that keeps every rule and flags it `cramped` |
| Bounds | hard | slots inside the site and the altitude band |
| References | hard | timed reference points a drone can fly from its position and velocity: speed changes of at most 2 m/s² between steps, at most 2.5 m/s, climbs of at most 0.8 m/s (13 November; was "at most 0.75 m per 0.5 s") |
| Flight safety | hard | no drone brings itself inside the 1.2 m floor of anyone (moving toward them, or both still while it could back away), no drone closing in on a person, no separation, wall or altitude violation |
| A person closing in | soft | episodes where a person walked or ran within 1.2 m of a drone that was not moving toward them (a sprinter can outrun a retreating drone, and anyone can walk up to a drone pinned by walls and people): at most 1% of episodes without doors and 1.5% with them (Dan, 17 November: a drone in a doorway, holding a door or at a shut exit has less room to back away); their segments are not training data |
| Training ticks | hard | no `use_for_training` tick has a stuck drone or a drone inside 1.2 m of anyone (decided on the unrounded distance) |
| Flicker | soft | a template that flips for one tick and back: under 0.5% of ticks |
| Swaps | soft | follower slots swapping: under 0.2% of ticks |
| Jitter | soft | slot movement while nothing changed: 95th percentile under 0.5 m |
| Stuck | soft | a drone that does not move for 5 s while its slot stays over 1 m away, not counting doorway queues or yielding: under 5% of drone-ticks |
| Yielding | soft | the same, with someone within 3.3 m: held back by the safety layer, under 10% of drone-ticks (counted apart since 13 November) |
| Pose error | soft | odometry drift, estimate against true pose: 95th percentile under 1.5 m |
| Doorway queues | soft | under 5% of drone-ticks; each drone's record now has `wait_door` |
| Hold | soft | automatic hold under 15% of ticks; hold of any kind under 25% |
| Usable | soft | over 80% of ticks fit for training |

**Why the first run's keep-out looked weak.** Of the 13 episodes scheduled with keep out as their only order:
- 12 had an intruder our model says cannot be deterred even by all three drones at 3 m;
- several defended a room with its own outside door, such as the kitchen's fire exit, where he is inside at 8 s, before a drone can arrive.

Changing the order time, the radio, the floor or the order's room name changed nothing. So the gap was in what was winnable, not in the pipeline: use `deterrable` and the segments to tell the two apart.

**First indoor run (13 November 2026, M1 MacBook), with the quality fixes and simulated perception:**

Size and quality:
- 600 episodes in 16 minutes on 7 worker threads, each paired with a grounded baseline on the same seed. 114,261 plan records and 1,406 order events, 29 MB gzipped. The scanned map takes about 11 MB of that.
- The scenarios: 296 intruders heading for a room, 127 hiding, 177 lost visitors; 419 random floors and 181 on the fixed office.
- Every record matches contract v0. The same seed gives the same records (`indoor.test.js`).
- **All 20 quality gates pass.** `quality_report.js` reports:

  | Measure | Result |
  |---|---|
  | Template flicker | 0.08% of ticks |
  | Follower swaps | 0.08% |
  | Slot jitter when nothing changed, 95th percentile | 0.03 m |
  | Stuck drones | 4.3% of drone-ticks |
  | Doorway queues | 2.3% |
  | Automatic hold | 2.4% of ticks |
  | Hold, all causes | 18.7% (35% before the fixes) |
  | Estimate error while in sight | 0.17 m median, 0.43 m 95th percentile |
  | Estimates from a false positive | 1.3% of ticks with an estimate |
  | Ticks fit for training (`use_for_training`) | 82.7% |

- **Perception:** the records' latest camera frames hold 67,359 true and 248 false detections. 44 of the false ones were confident enough to count, and 4 searches ended on one.
- **What the team knew:** at 33% of ticks the person was in sight, at 15% only an estimate from the last 4 s was known, and at 52% his position was unknown.
- **Templates in the labels:** search 27,051 · hold 21,361 · track 14,609 · lead (guide out) 11,107 · explore 8,749 · overwatch 8,157 · push (drive out) 6,603 · doors (contain) 5,031 · barrier 4,954 · return 4,098 · block 2,527 · ring 14.
  - Search includes the short searches that drive out, track and contain run when they lose him.
  - The contain ring needs a room at least 7 m across, so it is rare.
- **Bands:** comfort 101,348 ticks (89%), pressure 12,913 (11%).

The orders:
- 1,535 sampled phrasings: 1,406 orders, 59 questions and 70 refusals, from 185 templates and 1,199 distinct texts.
- 77 compound orders and 39 context pairs.
- 1,406 order events reached an episode; the rest were scheduled after the person had already left.

Parser agreement with the sampler's intended orders:
- 1,501/1,501 on seen phrasing templates and 34/34 on held-out ones; 108/108 on the held-out sweep.
- These numbers are optimistic: the grammar was fixed using earlier runs of this report.

**Safety on true positions, all 600 episodes:**
- No drone came within the 1.2 m floor; the closest in the pressure band was 1.35 m.
- No drone moved toward a person inside its band's limit for more than 0.5 s.
- No separation, wall or altitude violations.
- In 63 episodes (10.5%) a person came within 2.0 m of a comfort-band drone that was giving way, closest 1.38 m. This happens in corridors.
- Earlier runs of this set found three floor breaches and a climb above the altitude band; the fixes are in `docs/TACTICS.md`.

**Outcomes need care.** `summary.txt` gives outcomes by first order and for the 92 episodes scheduled with a single order. They are not tactic benchmarks:
- **Re-orders:** the first order is usually replaced 10–35 s later, often before an intruder arrives, so most episodes mix tactics.
- **Single-order episodes:**
  - Keep out let in 10 of 13 intruders, and drive out 9 of 12, against 11 of 13 and 11 of 12 with the drones grounded. That is mostly what was winnable: see "Why the first run's keep-out looked weak" above.
  - Guide out got 12 of 21 visitors out, and search found 8 of 12 hiders.
- **Perception costs:** episodes that started with a search found 59% of hiders, against 68% before perception. Controlled runs show no drop beyond noise (`docs/TACTICS.md`).
- **Benchmarks:** use the controlled runs in `docs/TACTICS.md`, where one order is given at 1 s and kept.

**Layout-diverse run (13 November 2026, M1 MacBook), eight floor families:**

Size and quality:
- 1,200 episodes in 24 minutes on 6 worker threads, each paired with a grounded baseline. 211,401 plan records and 2,766 order events, 58 MB gzipped.
- 374 test episodes: 293 on the held-out shop and irregular floors, 81 by the seed rule.
- Scenarios: 627 intruders heading for a room, 246 hiding, 327 lost visitors; 181 on a family's fixed floor.
- Every record matches contract v0, and **all 20 quality gates pass** overall.

| Measure | Eight families (`indoor2`) | Office only (`indoor1`) |
|---|---|---|
| Ticks fit for training (`use_for_training`) | 85.4% | 82.7% |
| Stuck drones | 3.9% of drone-ticks | 4.3% |
| Hold, all causes | 18.1% | 18.7% |
| Template flicker / follower swaps | 0.16% / 0.15% of ticks | 0.08% / 0.08% |
| Slot jitter when nothing changed, 95th percentile | 0.05 m | 0.03 m |
| Estimate error while in sight, median / 95th percentile | 0.17 / 0.42 m | 0.17 / 0.43 m |
| Estimates from a false positive | 1.3% | 1.3% |
| Closest approach, pressure / comfort band | 1.32 / 1.33 m | 1.35 / 1.38 m |
| Comfort pass-bys | 139 episodes (11.6%) | 63 (10.5%) |

Per floor family (`quality_report.js`). No family had a label rule break, an episode inside the 1.2 m floor, a drone closing in, or a separation, wall or altitude violation.

| Family | Episodes (test) | Ticks | Training ticks | Stuck | Person in sight | Closest: pressure / comfort |
|---|---|---|---|---|---|---|
| Office | 171 (16) | 31,132 | 87% | 2.8% | 29% | 1.38 / 1.33 m |
| House | 141 (7) | 24,354 | 71% | 8.7% | 46% | 1.32 / 1.36 m |
| Warehouse | 147 (20) | 30,939 | 84% | 4.2% | 43% | 1.45 / 1.49 m |
| Open-plan office | 144 (17) | 23,308 | 95% | 1.5% | 29% | 1.36 / 1.73 m |
| School or hospital | 164 (10) | 31,600 | 83% | 4.3% | 31% | 1.46 / 1.55 m |
| Shop (held out) | 149 (149) | 28,722 | 92% | 1.8% | 22% | 1.47 / 1.69 m |
| Single room | 140 (11) | 16,217 | 91% | 3.5% | 52% | 1.49 / 1.65 m |
| Irregular (held out) | 144 (144) | 25,129 | 83% | 4.6% | 42% | 1.50 / 1.54 m |

The orders:
- 3,006 sampled phrasings: 2,764 orders, 99 questions and 143 refusals, from 244 templates and 2,107 distinct texts.
- 133 compound orders, 83 context pairs, and 75 distinct named places across the families.
- The parser agrees with every intended order: 2,860/2,860 on seen templates, 146/146 on held-out ones, and 108/108 on the held-out sweep.

**Outcomes per family** (`summary.txt`) mix tactics as before, because orders are replaced 10–35 s apart:
- **Intruders who got in, against the grounded baseline:** 64% (83%) in houses, 65% (85%) in warehouses, 78–88% elsewhere, and 93% (99%) on open-plan floors. Open floors with several entrances are the hardest to defend.
- **Hiders found:** 37% in shops to 63% in houses. Shelving and racks hide people at 1 m.
- **Visitors guided out:** 11% in shops to 59% in single rooms.
- **Single-order episodes:**
  - Keep out let in 23 of 38 intruders, against 32 of 38 grounded.
  - Drive out let in 12 of 17, against 17 of 17.
  - Search found 24 of 27 hiders.
  - Guide out got 18 of 29 visitors out.

**People and realism run (`indoor3`, 17 November 2026, M1 MacBook): several people, diverse bodies, perception realism and flyable labels, on the eight families:**

Size and quality:
- 1,200 episodes in 37 minutes on 5 worker threads, each paired with a grounded baseline. 198,207 plan records and 2,752 order events, 72.5 MB gzipped.
- 374 test episodes: 293 on the held-out shop and irregular floors, 81 by the seed rule.
- Scenarios: 606 intruders heading for a room, 230 hiding, 364 lost visitors; 181 on a family's fixed floor. Other people share the floor in 1,111 episodes: one or two in 495, three or more in 616.
- Every record matches contract v0, and **every quality gate passes, hard and soft.**
- **Fixes found by this run.** Getting there took several rounds. Each round, a hard gate failed on one to five of the 1,200 episodes, and we traced it to its cause (`docs/TACTICS.md`, "Everyone, not only the subject"):
  - a drone that had climbed lost sight of a visitor's torso behind a door lintel (the drone now senses legs or torso);
  - a bystander walking up to a drone parked in a corner counted against the drone (a pinned drone is now the person's doing);
  - slots under 1 m apart in cramped corners (a last-resort placement, flag `cramped`);
  - a training tick at 1.197 m passed after rounding;
  - sight flickering at door jambs and shelf ends (drones remember hidden people for 10 s);
  - a drone at a wall end could not take its first step;
  - two drones closed to 0.59 m (escapes checked along the way, and one clamp for people and neighbours);
  - a bystander and a wedged drone held each other for 92 s (bystanders now give up after 3 s).
- **Determinism and the disk.** Episodes no longer depend on what ran before them in the same worker: the phase of the 0.05 s safety sampling used to carry over. The generator now survives a briefly full disk. App updates filled this Mac's disk to zero three times during these runs.

| Measure | People and realism (`indoor3`) | Eight families (`indoor2`) |
|---|---|---|
| Ticks fit for training (`use_for_training`) | 95.0% | 85.4% |
| Stuck drones (share of drone-ticks) | 0.8% | 3.9% |
| Held back by the safety layer near a person (yielding) | 4.3% | counted as stuck |
| Queuing for a doorway | 1.6% | 2.0% |
| Hold, all causes / automatic after an order | 18.5% / 2.8% | 18.1% / 2.6% |
| Template flicker / follower swaps | 0.16% / 0.10% | 0.16% / 0.15% |
| Slot jitter when nothing changed, 95th percentile | 0.003 m | 0.05 m |
| Person in sight / estimate only / unknown | 23% / 18% / 59% | 36% / 13% / 51% |
| Estimate error while in sight, median / 95th percentile | 0.26 / 0.71 m | 0.17 / 0.42 m |
| Estimates from a false positive | 0.05% | 1.3% |
| Drone pose error from odometry drift, 95th percentile | 0.52 m | none (no drift) |
| Route labels against the flight at +2 s, median / 95th percentile | 0.09 / 1.36 m | 0.28 / 2.28 m (old labels) |
| Comfort pass-bys | 540 episodes (45%) | 139 (11.6%) |

- **Training ticks rose from 85% to 95%, and stuck drones fell from 3.9% to 0.8%.** A drone held back by the safety layer near a person now counts as yielding (4.3% of drone-ticks) and stays in training.
- **The person is in sight less (23% of ticks, against 36%).** People now sit, crouch, lie and hide, other people block the view, and dim or dark rooms lower the hit rate.
- **The estimate is less accurate (0.26 / 0.71 m, against 0.17 / 0.42 m).** Detections are placed from each drone's drifting pose estimate, and followers' detections reach the master late over the radio.
- **Comfort pass-bys rose from 12% to 45% of episodes.** Almost all are other people walking past a drone that is giving way.
- **Route labels now match the flight:** a median of 0.01 m off at +0.5 s and 0.09 / 1.36 m at +2 s (median / 95th percentile), against 0.28 / 2.28 m with the old labels. Most of what is left is the safety layer holding a drone back.
- **The `cramped` placement fired at 796 of 198,207 ticks, in 88 episodes.**

Per floor family (`quality_report.js`). No family had a label rule break, an episode with drone-caused floor time, a drone closing in, or a separation, wall or altitude violation. The closest approach now includes people who walked up to a drone; the drone's own closest approach stays at 1.2 m or more by the hard gate.

| Family | Episodes (test) | Ticks | Training ticks | Stuck | Yielding | Person in sight | Comfort pass-bys | Closest, any cause: pressure / comfort |
|---|---|---|---|---|---|---|---|---|
| Office | 171 (16) | 30,729 | 94% | 0.8% | 3.3% | 19% | 94 | 1.31 / 1.20 m |
| House | 141 (7) | 23,119 | 94% | 1.1% | 5.2% | 34% | 71 | 1.23 / 0.98 m |
| Warehouse | 147 (20) | 25,565 | 97% | 0.3% | 2.9% | 30% | 70 | 1.37 / 1.09 m |
| Open-plan office | 144 (17) | 26,003 | 93% | 1.3% | 5.1% | 14% | 56 | 1.47 / 1.20 m |
| School or hospital | 164 (10) | 26,983 | 92% | 1.2% | 5.9% | 16% | 98 | 1.24 / 1.22 m |
| Shop (held out) | 149 (149) | 28,464 | 98% | 0.3% | 1.8% | 17% | 71 | 1.32 / 1.17 m |
| Single room | 140 (11) | 16,209 | 98% | 0.1% | 4.7% | 28% | 24 | 1.47 / 1.07 m |
| Irregular (held out) | 144 (144) | 21,135 | 94% | 0.7% | 6.8% | 28% | 56 | 1.51 / 1.12 m |

**By who the subject is** (the quality report's split):

| Split | Group | Episodes | In view | Intruders who got in | Hiders found | Visitors guided out |
|---|---|---|---|---|---|---|
| Age | adult (18-64) | 1029 | 18.7% | 508/575 | 100/223 | 83/231 |
|  | child (<13) | 36 | 21.7% | — | — | 16/36 |
|  | older (65+) | 78 | 29.5% | — | — | 26/78 |
|  | teen (13-17) | 57 | 23.5% | 25/31 | 4/7 | 9/19 |
| Height | 1.50-1.70 m | 638 | 20% | 286/325 | 46/109 | 78/204 |
|  | 1.70-1.85 m | 449 | 19.1% | 201/230 | 48/104 | 35/115 |
|  | <1.50 m | 62 | 18.6% | 20/22 | 2/3 | 18/37 |
|  | >=1.85 m | 51 | 23.8% | 26/29 | 8/14 | 3/8 |
| Mobility aid | cane | 19 | 36.2% | — | — | 3/19 |
|  | none | 1155 | 19.2% | 533/606 | 104/230 | 117/319 |
|  | pushchair | 19 | 34.4% | — | — | 10/19 |
|  | wheelchair | 7 | 27.1% | — | — | 4/7 |
| Posture | mostly low (sitting, crouching, lying) | 198 | 8.5% | — | 77/191 | 4/7 |
|  | mostly standing | 1002 | 22% | 533/606 | 27/39 | 130/357 |
| Speed | never above 3 m/s | 646 | 19.8% | 64/89 | 80/193 | 134/364 |
|  | ran at 3 m/s or more | 554 | 19.7% | 469/517 | 24/37 | — |
| Skin tone (Monk scale) | 1-3 | 325 | 19.8% | 152/170 | 27/61 | 29/94 |
|  | 4-7 | 493 | 19.7% | 209/244 | 42/90 | 61/159 |
|  | 8-10 | 382 | 19.7% | 172/192 | 35/79 | 44/111 |
| Other people | 1-2 others | 495 | 23.2% | 225/260 | 42/90 | 49/145 |
|  | 3+ others | 616 | 15.7% | 273/303 | 52/125 | 67/188 |
|  | alone | 89 | 28.6% | 35/43 | 10/15 | 18/31 |

- **Skin tone is flat by construction:** the simulated detector ignores it. The split is a baseline for a real detector on rendered frames.
- **Posture matters most.** People who mostly sat, crouched or lay were in view 8.5% of the time, against 22%. Hiders who did were found 77 of 191 times (40%), against 27 of 39 (69%).
- **Crowds hide the subject:** in view 29% alone, 23% with one or two others, and 16% with three or more.
- **Runners get in:** 469 of 517 (91%) of intruders who ran at 3 m/s or more got in, against 64 of 89 (72%) of those who never did.
- **Visitors with a cane** were guided out 3 of 19 times, against 117 of 319 with no aid. At 0.65–1.1 m/s, many probably do not reach an exit within 180 s.

**Floor time that was the person's doing** (the soft gate, at most 1% of episodes): 12 episodes, 112 s in all, none of it training data.
- In three, the subject, a visitor being guided or tracked, walked into a drone: 99 s, almost all of it one visitor stuck for 84 s (weak point 2 below).
- In eight, a bystander walked in on a drone, or up to one pinned by walls and people: 11 s.
- In one, an intruder ran at a drone during a search: 1.7 s.

**Perception.** The records' latest frames hold 76,735 detections of the subject, 80,244 of other people and 396 false positives, 53 of them confident enough to count. No search ended on a false positive. Estimates taken from a false positive fell from 1.3% of ticks with an estimate to 0.05%, because the team now fuses only its target's track.

**Outcomes** (`summary.txt`) still mix tactics, because orders are replaced 10–35 s apart:
- **Intruders:** 533 of 606 got in with the drones flying and 532 with them grounded. 30 of 170 deterrable intruders were kept out.
- **Per family:** intruders who got in, against the grounded baseline: 87% (95%) in schools or hospitals, 78% (84%) in houses, 88% (76%) on irregular floors, 90% (91%) in offices, 92% (88%) on open-plan floors, 93% (87%) in shops, 91% (100%) in single rooms and 85% (83%) in warehouses.
- **Hiders and visitors:** 104 of 230 hiders were found and 134 of 364 visitors guided out.
- **Single-order episodes:** keep out let in 21 of 25 intruders (23 of 25 grounded), drive out 21 of 24 (23 of 24), search found 22 of 31 hiders, guide out got 31 of 40 visitors out, and track kept the intruder in view 25% of the time.

**What is weak:**
1. **The drones no longer stop intruders.** With the drones flying, 88% of intruders got in, the same as with them grounded (88%); in the families run it was 64–88% against 83–99%. Three things stack up:
   - 85% of intruders now run at 3 m/s or more at some point, and the drones fly at 1.5 m/s (2.5 m/s to get clear of someone);
   - the drones keep the comfort standoff from every bystander;
   - the team sees the subject less.

   In four families (irregular floors 88% against 76%, shops 93% against 87%, open-plan floors 92% against 88%, warehouses 85% against 83%), more intruders got in with the drones flying than grounded, probably because pressure from the drones makes the person model run. The controlled runs, with identical people at 2 m/s, still show the tactics working: keep out let in 9 of 12, against 12 of 12 grounded (`indoor.test.js`). Before keep-out and drive-out labels are used for training, the tactics need rework for runners, for example by pre-positioning at doors early, or a practitioner should check how many intruders really run.
2. **A wandering visitor and a pinned drone can still hold each other.** In one episode a visitor pressed against a wall stood 1.08 m from a drone pinned above head height for 84 s. The drone is pinned, so the gate rightly counts this as the person's doing, and the segment is not training data. The subject has no give-up rule like the bystanders', and its recorded velocity is the step it tried rather than the step it made. That fix is queued.
3. **Seeing and estimating are harder** (in view 23%, estimate error 0.71 m at the 95th percentile): that is the realism working, but NN1 will learn from noisier inputs.
4. **Pass-bys in 45% of episodes** mean bystanders often come within 2 m of a drone that is giving way; the comfort band cannot hold in corridors and shops.
5. **Not yet real:** movement patterns are not tuned to recorded tracks (THÖR waits for Dan's download approval), and appearance is not rendered.

## Open questions for Prat

1. Is "slot + vector every 0.5 s" the right output for NN1, or should NN1 emit time-stamped reference points, as the 10 November briefs recommend? `swarm-indoor` logs both.
2. Should NN1 see the belief map, or only a compact summary?
3. Which goals should v1 support beyond keep out, drive out, track and hold? Swarm Indoor has ten; guide out and search are the strongest teachers today.
4. Is the person model's range of "deterrability" right? It caps what keep out and drive out can achieve (`docs/TACTICS.md`).
5. For the outcome labels, should episodes keep one order long enough to finish (gaps of 30–90 s), or are frequent re-orders more useful for NN1? Today's 10–35 s gaps give many transitions but blur outcomes.
6. **NN1's inputs:** we assume NN1 consumes perception outputs, not raw frames: person detections with confidence, the scanned map, search coverage and camera views, plus the order and team state. Rendering and detector training would be a separate perception and sim-to-real workstream. Is that the split you want, and should the floor plan be an input, or should NN1 work map-free?
7. **Held-out floor families:** shop and irregular floors are test only, a quarter of the indoor episodes. Are those the right families to hold out, or should a whole family be held out per release instead?
8. **Cuts and resolution:** which cuts do you want (NN1 on perception outputs, the detector on frames and boxes, end-to-end), and at what frame resolution and rate for NN1 and for the detector?
9. **Person attributes:** which person attributes should NN1 see (for example posture, mobility aid, apparent height, group membership), and which stay metric-only in `ground_truth`?
10. **Doors:** if the POC adds doors that open and close, the scanned map changes during an episode, since a closed door reads as a wall. Should NN1 see door states as their own input, or only through the map? And should the operator be able to order a drone to wait at a door until someone opens it?
