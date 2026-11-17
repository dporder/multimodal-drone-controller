# Tactic library v0 (indoor teacher templates)

*Dan, 12 November 2026. For review by Prat. Status: proposal; numbers are starting values to tune in simulation.*

The scripted "teacher" turns a goal plus what the drones currently see into a target slot for each of the three drones every planning tick. It does this the same way Swarm Mind does: a template, then vectors M, S1, S2 = slot − position. Neither of us is a tactics expert, so each template is anchored in public sources:

- **Names and intent** come from US Army doctrine terms (approved for public release).
- **Distances and geometry** come from robotics papers, civil search-and-rescue guidance and human–drone comfort studies.
- Doctrine itself gives no distances.
- Armed room-entry drills are **not** borrowed; only room-by-room bookkeeping is.

## Symbols

| Symbol | Meaning |
|---|---|
| M | master |
| S1, S2 | followers |
| Î | estimated position of the person, from observations only, never the simulator's truth |
| n, t | a door's normal (pointing out of the protected room) and tangent |
| d_s | standoff from a person: 1.5 m in pressure tactics, 2.5 m in comfort tactics (see "Safety envelope") |
| vantage | 1 m inside a door on its axis, or 0.6 m in from a room corner |

## Templates

### Hold
- **Doctrine:** none needed.
- **Grounding:** PX4 Hold mode, "stop and hover" [1].
- **Geometry:** keep the positions held when the order was accepted. A drone standing in a door zone first moves out of it.
- **Done when:** never; this is a standing goal.

### Keep out
- **Doctrine:** *block* (deny access to an area or approach) and *secure* [2][3].
- **Grounding:**
  - Multi-agent perimeter defense: defenders stay on the boundary and must be at least as fast as the intruder [4].
  - People slow down when a robot crosses their corridor [5].
- **Geometry:**
  - The doorway is treated as a short boundary. D* = the protected room's door nearest Î by path length, with 1 m hysteresis.
  - S1 hovers in the door plane at D* + 0.5n. S2 joins at ±0.5t if the door is wider than 1.2 m.
  - M takes a vantage at least d_s from Î that covers the corridor approach.
  - Drones never advance on the person.
  - Two doors: one drone each; M doubles up wherever he comes within 4 m.
  - **As built:** once he is in sight within 9 m (walking) of D*, all three drones *block*: they mass across his approach 1.6 m before the door, 1.1 m apart. One drone alone is easy to walk past, and every drone must give way at the standoff, so only massing can deter him.
  - **As built (13 November):** in a small protected room (under 40 m², such as a bedroom or a site office), block slots that would retreat inside the room ahead of him flank the door outside instead. A drone that backs into a small room ahead of an intruder is shut in with him once he is through. In one warehouse episode such a drone was cornered: it climbed to 4.4 m, but he stood 1.19 m from it (horizontally) for 3 s.
  - **As built:** once he is in sight and within 4 m (walking) of a door of the protected room, keep out uses the pressure band (1.5 m); before that, the comfort band.
  - **As built:** while he is unseen, the cameras watch his last known position (a door sensor counts), not straight out of the door. Before this fix, an intruder walking down the corridor was often never seen.
- **Done when:**
  - He enters (breach): failed, then hold.
  - He stays more than 6 m from the doors for 10 s: deterred.

### Drive out (intruders only; flagged for ethics review)
- **Doctrine:** *turn*, *canalize*, *clear* [2].
- **Grounding:**
  - Shepherding: push from behind on the line from the goal to the target, and stop when too close [6].
  - Route maps for herding through obstacles [7].
- **Geometry:**
  - g = the next door-to-door leg toward the exit.
  - Driver at Î − r·g; flankers at Î − r(cos 60°·g ± sin 60°·n).
  - r = 2.5 m, tightening to 1.5 m (the pressure band) while he stalls. (Was 3.0 m tightening to 2.5 m, before the standoff bands.)
  - At most 0.5 m/s within 4 m of him.
  - **Ethics flag:** approaches from behind are the least comfortable for people [17], and the pressure band brings drones to 1.5 m. This is deliberate (Dan, 12 November 2026) and stays flagged for review.
- **Done when:** he is at least 1 m past the exit door, then hold. Failed after 90 s.
- **As built:** the exit choice sticks unless another exit is at least 5 m closer for him, so the push does not flip between exits.
- **As built (13 November):** the exit is the nearest for him on foot, but one where our drones stand between him and the door (within 3 m of it, nearer to it than he is) counts as 12 m further per drone. He would have to pass them, and in a corridor they cannot get behind him. Without this, two drones at a house's front door left an intruder who wanted to leave stuck 1.15 m from them for two minutes. Over 40 controlled office runs, drive out let in 19 intruders, against 21 before.
- **Swarm Mind fix:** its current `driveout` reuses the keep-out formula. Our branch replaces it with this push.

### Guide out (civil default: evacuation, a lost visitor)
- **Grounding:** in a simulated fire, all 26 participants followed a guide robot, even after seeing it fail. This shows the method works, and also the risk of over-trust [8].
- **Geometry:** the leader flies 3 m ahead on the route to the exit, turned toward him. The followers trail at 3 m and keep line of sight through doors.
- **As built (changed after testing):** drones cannot pass a person in a corridor at the standoff, so roles follow where each drone already is.
  - **Leader:** the drone nearest the exit leads, 4 m ahead on the route, or closer if needed to keep line of sight.
  - **Column:** drones already ahead of the visitor fly 6.5 m and 9 m along the route.
  - **Trailing:** drones behind her trail 3 m back, or hold where they are if reaching that point would mean passing her.
  - **Exit choice:** the nearest exit that some drone is already closer to than she is, unless the order names one.
  - **At the exit:** within 4.5 m of it, all three stand aside outside, either side of the door, so the way out is clear.
- **Done when:** he is outside. Failed after 150 s.

### Track (relay chain, like Swarm Mind's "elastic strings")
- **Grounding:**
  - Keeping a moving target in view among obstacles [9].
  - Relay chains of tiny drones underground [10].
  - Coordinated standoff tracking [11].
- **Geometry:**
  - The tracker follows 3 m behind on his trail, taking the inside line at corners to delay losing sight.
  - R1 and R2 hold the first two corners of the shortened path back toward the operator, at most 6 m apart, so every link keeps line of sight.
  - They are ordered along the path, so they never swap.
- **Done when:**
  - He is lost: go to his last-known position.
  - After 5 s: search.
  - After 60 s: hold.

### Contain ("surround")
- **Doctrine:** *contain* (stop, hold or surround) [2].
- **Grounding:** cyclic-pursuit encirclement, which leaves the drones at equal angles [12][13].
- **Geometry:**
  - Where he stands in a room at least 7 m across: a ring of radius 3 m at 120° spacing, rotated to fit the walls. In an L-shaped room the part he stands in must be 7 m across.
  - Smaller rooms: one drone just outside each door of his room, with M at the busiest door. Spare drones flank the busiest door 1 m out and 1.5 m to either side, along the corridor or hallway rather than across it.
- **Done when:** every drone has held its slot for 3 s. If he is lost: search. **As built:** a standing goal; the 3 s check is not implemented yet.

### Search
- **Doctrine:** *clear* [2].
- **Grounding:**
  - INSARAG search levels [14].
  - US&R building marking, an X per room recording team, time in and out, people found and hazards [15].
  - Pursuit–evasion bookkeeping: a cleared area is "recontaminated" through an unwatched door [16].
- **Geometry:**
  - Search depth follows INSARAG levels: "quick look" = level 2, "search the building" = level 3, "search thoroughly" = level 5.
  - Each room keeps an X-mark record with status unsearched / entered / cleared.
  - M guards the hub vantage that sees the most doors between cleared and uncleared rooms.
  - S1 and S2 each take the nearest uncleared room in the belief set, visit its viewpoints and spin 360° at each. Viewpoints are one per ~6 m: along the long axis of a narrow room, or a grid walked as a snake over a wide one (a warehouse hall, an open-plan floor). Each rectangle of an L-shaped room gets its own.
  - A room reopens if an unwatched door links it to uncleared space.
- **Done when:** he is found, or every room is cleared to the level's coverage (95% at level 5).

### Explore / map
- **Grounding:**
  - Frontier-based exploration [18].
  - Multi-robot assignment by value minus travel cost, with value discounted near targets already assigned [19].
  - RACER as an upgrade [20].
  - Tiny-drone swarm exploration [21].
- **Geometry:**
  - A 0.1 m belief grid built from depth rays (90° wide, 5 m range).
  - Each drone takes the frontier cluster that maximizes value − β·path.
  - **As built:** each drone gets a frontier of its own. A drone with none left holds and looks around instead of queuing behind the others at the same doors.
  - Drones fly only through known-free cells.
- **Done when:** no reachable frontier of at least 0.5 m² is left.
- **As built:** a frontier counts from 4 cells (0.8 m), because a doorway into an unseen room is only 5 cells wide; only the building is mapped, not the outside; the drones first take off and look around.

### Overwatch
- **Doctrine:** *overwatch* and bounding overwatch [2].
- **Geometry:**
  - Greedy placement on corner and door vantages to maximize the visible area.
  - A doorway gets one vantage on each side.
  - When moving, one drone watches while the other moves.
- **Done when:** never; this is a standing goal.

### Return
- **Grounding:** PX4 return and land modes.
- **Geometry:** landing pads 1 m apart in the home room. Door locks apply. Land at 0.3 m/s.
- **Done when:** all three drones have landed.

## Safety envelope (indoor)

EU drone rules do not cover indoor flight [22], so the limits below come from comfort studies and our own judgement:
- **Standoff bands (Dan, 12 November 2026).** Drive out is meant to approach a person uncomfortably close; only collision and arm's reach, being knocked down, are ruled out. So every tactic has a hard floor plus a band:
  - **Floor, 1.2 m:** arm's length (about 0.7–0.8 m), plus a lunge (about 0.3 m), plus sensing noise and reaction delay.
  - **Pressure, 1.5 m:** drive out, and keep out once he is at the door.
  - **Comfort, 2.5 m:** everything else, and always with visitors.
  - **Sources:** the 1.5 m and 1.2 m values are our own judgement, not a published standard. The comfort band follows Abioye et al., who found discomfort under 2 m [23]. Drive out keeps its ethics flag.
- One drone is uncomfortable under 2 m, moderate at 2–3 m and fine beyond 3 m. Two drones push each zone out by about 1 m [23].
- People prefer a frontal approach at 0.5 m/s, and like approaches from behind least [17].
- Height effects are mixed, so we fly near eye height [24][25][26].

| Limit | Commanded (estimated positions) | Checked in tests (true positions) |
|---|---|---|
| Speed | ≤ 1.5 m/s; ≤ 0.5 m/s in door zones and within 4 m of a person; never toward a person faster than 0.5 m/s, in every band | |
| Separation between drones (horizontal, no stacking) | 1.0 m | ≥ 0.6 m |
| Safety floor (every tactic) | — | never below 1.2 m |
| Standoff, pressure band: drive out, and keep out once he is at the door | 1.5 m | ≥ 1.2 m |
| Standoff, comfort band: every other tactic, and always with visitors | 2.5 m (3 m when two or more drones are within 4 m) | ≥ 2.0 m |
| Wall clearance | 0.4 m | ≥ 0.25 m |
| Altitude | 1.2 m to ceiling − 0.5 m, nominal 1.6 m | within the band |

Further rules:
- One drone at a time in a door zone (door ± 0.8 m).
- No overtaking where space is under 1.8 m wide.
- Refuse orders to strike, ram or corner a person.
- Followers hold if their radio link is more than 1 s old.
- An unclear or unattainable goal triggers the fallback: hold, then return.

## The simulated person is an assumption

No public study shows how an *unwilling* person reacts to drones; all the evidence comes from cooperative participants. Our model is therefore an explicit, randomized assumption:
- **Heading:** the direction to his goal, plus a push of k_fear·Σ s_j away from each drone j, plus k_flank around blockers, where s_j = clamp(R_react/d_j − 1, 0, 3). The push grows as a drone comes closer. The cap was 2, which bound from 0.83–1.5 m, inside the pressure band for the most reactive people. A cap of 3 binds only below R_react/4 ≤ 1.13 m, inside the 1.2 m floor.
- **Parameters, hidden from the teacher and drawn per episode:**
  - R_react: 2.5–4.5 m.
  - k_fear: log-uniform 0.5–3.
  - k_flank: 0–1.
  - T_resolve: 10–60 s (patience before giving up).
- **Leaving:**
  - An intruder heads for the nearest exit on foot, avoiding one with drones hovering at it (each counts as 12 m more walking), and chooses again after 3 s blocked.
  - A lost visitor being guided goes where the drones are. When the guide hovers at an exit close to her, she takes it as the way out and leaves by it.
  - Before this, she waited 3 m from a guide that could not pass her to reach the door: guide out got 3 of 12 controlled visitors out instead of 8; now 10 (added 13 November).
- **Bodies, speeds and movement (13 November):** each person has an age, sex, height, width and possibly a mobility aid. Speeds come from gait data (walking) or our assumption (running and sprinting, up to 6.4 m/s). Movement includes stop-and-go pauses, hesitation at doors, doubling back, dodging, sprint bursts, wall-hugging and crawling hiders. Sources are in `docs/DATASET_PLAN.md`, "Diverse people".
- **What the teacher assumes:**
  - The person may run at 4.5 m/s.
  - The estimate may be up to 1 m off: detector noise, odometry drift and radio delay. Every room within 1 m of the estimate stays in the belief.
  - A drone cannot outrun a sprinter, so episodes where a person runs past a retreating drone are counted apart from the drone's own floor breaches.
- **Other people:** they walk between rooms, pause and sit, keep about 2.5 m from drones, and wait while one hovers ahead of them. After 3 s of waiting, or of getting nowhere, they pick somewhere else to go. Before that rule, a visitor pressed against a wall and a drone wedged in by four people stood 1.19 m apart for 92 s. A walker's recorded velocity is the motion it makes, so one pressed against a wall counts as standing. Their movement draws from its own stream, so it cannot carry information about the hidden subject.
- **Margin:** a metric-only field records whether a formation could stop him at all, so impossible cases are not counted as teacher errors.
- **Review:** these tactics are grounded but not validated by a practitioner. A review by a search-and-rescue, police or security professional is planned.

## As built in `simulators/swarm-indoor`, and how well it works (12 November 2026)

**Floor families (13 November).** Every template runs on eight single-level floor families: office, house or apartment, warehouse, open-plan office, school or hospital, shop, single room, and irregular floors with L-shaped rooms (`docs/DATASET_PLAN.md`, "Layout families"). The outcome numbers below are for the fixed office floor. `indoor.test.js` runs every order on every family and checks safety on true positions.

**Everyone, not only the subject (13 November).** Episodes now hold several people (`docs/DATASET_PLAN.md`, "Diverse people"):
- The safety layer below keeps clear of every person in sight. The pressure band applies only to the subject; everyone else gets the comfort band.
- The validator keeps every slot at the comfort standoff from every other person the team has placed. Each round runs, in order:
  1. clearance from other people;
  2. separation;
  3. the rotation around the subject;
  4. the subject's standoff, last.

  In a cramped corner where five rounds still leave two slots under 1 m apart, one of them moves to the nearest point that keeps every rule (1 m from the others, the subject's standoff, and if possible the comfort standoff from everyone else). The label flags it `cramped`. In the 1,200-episode run it fired at 796 of 198,207 ticks (0.4%), in 88 episodes.
- A drone counts a person as in sight if a line reaches their torso or their legs. With the torso alone, a drone that had climbed lost sight of a visitor behind a door lintel and closed to 1.18 m (one episode in 1,200).
- The no-approach rule also holds anyone the drone saw in the last 10 s who is still within 4.5 m but out of sight, as an onboard tracker keeps a person who stepped behind a shelf or a door jamb. Without it:
  - a drone drifted toward someone standing 1.5 m away in the ticks they flickered out of sight;
  - a drone boxed in above head height fled over a shelf onto a visitor it had lost 2 s earlier.

  Backing away still uses sight alone: holding hidden people there as well cut track's time in view from 42% to 34%.
- Removing the motion toward one person can add motion toward another, so the no-approach clamp repeats until no motion points at anyone inside their limit. It treats a neighbour within 0.9 m the same way: the people pass once undid the neighbour pass, and two drones holding near people closed to 0.59 m.
- Sliding along a wall never turns into an approach to a person or a neighbour: the drone stops instead.
- An escape direction must be open along the way (at 0.1, 0.2 and 0.35 m), not only at its end. It must also not close on anyone else inside their limit, whether people in sight or remembered, or a neighbour within 0.9 m; the clamp would cancel that motion. With no such direction, the drone is pinned. A drone beside the end of a wall once chose a direction whose end point lay past a blocked cell, could not take its first step, and hovered 1.15 m from a bystander for 98 s.
- A drone someone is closing in on, that cannot back away (between two people, or pinned), climbs above head height.
- **Whose doing floor time is:** the drone's when it moves toward the person, or when both are still while it could have backed away. It is the person's when they walk or run in while the drone is not moving toward them, or when they walk up to a drone pinned by walls and people on every side (it cannot get there itself, since it never moves toward anyone inside their limit). Example: a member of staff heading for a doorway walked up to a drone parked in the corner beside it.

**On-board safety layer.** The teacher only places slots. Each drone's flight layer also enforces the envelope:
- **Person in sight:** it backs away whenever the person is within its band's standoff + 0.3 m (1.8 m pressure, 2.8 m comfort), plus 0.6 s × his closing speed, and sidesteps out of his path. Near a person it may fly at up to 2.5 m/s to get clear. If a wall or corner is behind it, it takes the free direction that best opens the distance; if it is boxed in, it climbs to 2.5 m, above reach, until clear. The band travels with each radio vector; a follower whose link is older than 1 s falls back to comfort.
- **Walls and neighbours:** wall repulsion; separation has priority, so a drone never closes on a neighbour within 0.9 m.
- **Never toward a person inside the band's limit:** whatever else pushes a drone (a wall it is pinned against, a neighbour), its velocity toward a person in sight is capped at 0.5 m/s, and at zero within the band's limit + 0.3 m (1.5 m pressure, 2.3 m comfort). Before this, wall repulsion carried a pinned drone toward a person running past for 0.55 s in one episode.
- **Doorways:** one drone per doorway at a time; a drone reroutes after 2 s if a doorway is occupied by a parked drone. A doorway also stays closed to a drone while a person stands within its band's standoff + 0.3 m on the far side, where the door frame can hide him from the camera.
- **Paths:** in the comfort band, while a drone sees the person, paths keep out of a disc of the standoff − 0.3 m around him. Not around a stale estimate, which would block the corner a tracker must pass to find him again.
- **Take-off:** no take-off while a person is within 2.5 m.

**Outcomes on the fixed office floor** (`node simulators/tests/indoor.test.js`). The baseline is the same seeds with the drones on their pads.
- Intruders get 0–15 s of warning; the first order comes at 1 s.
- An intruder counts as **deterrable** if all three drones at 3 m could stop him under his hidden parameters. That is k_fear·3·(R_react/3 − 1) ≥ 1, true for about 40% of sampled people.

| Goal | Result | Baseline |
|---|---|---|
| Keep out (12 intruders) | 9 breached; 2 of 7 deterrable kept out | 12 breached |
| Drive out (12 intruders) | 6 breached; 4 of 7 deterrable kept out | 12 breached |
| Guide out (12 lost visitors) | 6 outside within 180 s | 0 |
| Search (8 hiders) | 7 found | 0 |
| Map the floor (6 runs) | 3 at least 90% mapped within 180 s | — |
| Track (16 intruders) | in view 46% of the time | 0% |
| Return (3) | all landed | — |
| Keep out, 40 intruders | 26 breached; 11 of 20 deterrable kept out | 39 breached |
| Drive out, 40 intruders | 23 breached; 12 of 20 deterrable kept out | 39 breached |
| Keep out on random floors, 16 intruders for each of 5 protected rooms | 47 of 80 breached (storage 4 of 16, kitchen and meeting room 12 of 16) | 74 of 80 breached |
| Safety (all of the above) | never within the 1.2 m floor (closest in the pressure band: 1.34 m); no separation, wall or altitude violations; no drone moved toward a person inside its band's limit for more than 0.5 s | — |

**With simulated perception (13 November 2026).** The teacher now acts only on simulated detections: misses, position noise, confidence and rare false positives (`docs/DATASET_PLAN.md`, "Inputs"). Same seeds and the same order kept from 1 s, on the office floor:

| Goal | Before | With perception |
|---|---|---|
| Keep out, 40 intruders | 27 breached | 22 breached |
| Drive out, 40 intruders | 22 breached | 22 breached |
| Search, 12 hiders | 10 found | 11 found |
| Track, 12 intruders | in view 47% | in view 49% |
| Guide out, 12 visitors | 6 outside | 8 outside |

- **Controlled runs:** none got worse beyond run-to-run noise. Short misses barely matter, because the estimate is held for 4 s and the tactics already work from estimates.
- **The mixed dataset:** perception does cost something there. Searches that started the episode found 59% of hiders, down from 68%. 4 of the 600 episodes had a search end on a false positive. The person was in sight 33% of the time, down from 37%. "In view" now counts only confident true detections, so it is not directly comparable to the old geometric number.

**What this does and does not show:**
- **Keep out and drive out mostly measure our person model.** A drone that must give way cannot physically stop anyone, so success depends on whether he is put off. The pressure band helps drive out most: 23 of 40 breached, down from 25 with a single 2.5 m standoff. With the parameter ranges above, most people are not put off even by all three drones at 3 m. The plan's target was keep-out breaches 30 points below the baseline. On 40 seeds keep out now reaches 32 points (26 against 39 breached), but it stops 11 of 20 deterrable intruders and only 3 of the other 20, so results are reported split by "deterrable". If practitioners say real intruders are more easily deterred, the ranges should change, not the tactic.
- **Corridors are narrower than the comfort standoff.** A person walking or running past a drone in a 2.4 m corridor can come within 2 m while the drone gives way.
  - It happened in 4 of 40 keep-out and 9 of 40 drive-out episodes, during their comfort phases, and in some map-the-floor runs where a wandering visitor walked up to an exploring drone.
  - The tests require that no drone is ever closer than 1.4 m in the comfort band. Across the 600-episode dataset the closest comfort-band pass-by was 1.28 m, still outside the 1.2 m floor.
  - The tests allow these pass-bys only while the drone is not moving toward him. A drone moving toward a person inside its band would be a teacher error.
- **Tracking is weak** (about 45% in view on the office floor). The tracker slows to 0.5 m/s in doorways and waits for door locks, so it falls behind when he turns into a room.
- **Search is not exhaustive below level 5.** A room is cleared at the level's coverage, so a hider can be missed in the uncovered part (rare: at most once in about 1,500 unseen ticks in the tests).
- **The visitor model is ours.** The visitor follows the lead drone when it is within 6 m and in sight, and stops 3 m from it. While she follows, she is only 30% as put off by that one drone; she still keeps her distance from the others. When guide out ends she stops following and walks off on her own; before that fix she walked up to the last lead drone and pinned it in a corner.
- **Slots and doorways (validator):**
  - Only door-holding tactics place a slot in a doorway: keep out's screen and block, and contain. Any other slot in a door zone moves 1 m clear of it, because a parked drone holds the door's lock and blocks the others.
  - The validator applies the person's standoff last, then rotates slot pairs that are still under 1 m apart around him, so neither rule is undone.
  - A follower's target height stays inside the altitude band.
- **Bugs found and fixed while testing:**
  - Walking distances to doors were computed with a float32 rounding bug that cut them off about 3 m from each door. This broke door choice, drive-out routing and guide-out.
  - The "could he be here" rooms used room-centre distances, so a man last seen at a doorway could be ruled out of the room beside him. The belief test now guards both.
  - The first 600-episode dataset run had 2 guide-out episodes where a drone came within the 1.2 m floor (1.12 m). A follower crossed a doorway toward a far slot while the visitor stood just beyond the frame, out of its camera's sight, so its back-away reflex fired too late. The doorway and path rules above fix it, and the safety test now covers it.
  - The second run had one more floor breach: after guide out timed out, the visitor walked toward a drone holding near a corner, and its back-away reflex pushed it straight into the corner (1.02 m). The escape rule above fixes it.

## Sources (checked 12 November 2026)

1. PX4, [Hold Mode (Multicopter)](https://docs.px4.io/main/en/flight_modes_mc/hold.html).
2. HQDA, [FM 1-02.1 *Operational Terms*, May 2026](https://armypubs.army.mil/epubs/DR_pubs/DR_a/ARN46659-FM_1-02.1-000-WEB-1.pdf). Approved for public release, distribution unlimited. Terms *block*, *secure*, *turn*, *canalize*, *clear*, *contain*, *overwatch*.
3. HQDA, [FM 3-90 *Tactics*, May 2023](https://armypubs.army.mil/ProductMaps/PubForm/Details.aspx?PUB_ID=1026901), the publication that owns the tactical mission task definitions.
4. Shishika, Paulos & Kumar, [Cooperative team strategies for multi-player perimeter-defense games](https://arxiv.org/abs/1912.04342), IEEE RA-L 2020.
5. Chen, Jiang & Guo, [arXiv:1802.05730](https://arxiv.org/abs/1802.05730), 2018: field test in which a ground robot crossing a building's exit corridor slowed pedestrians (faster robot, more slowing).
6. Strömbom et al., [Solving the shepherding problem](https://pmc.ncbi.nlm.nih.gov/articles/PMC4191104), J. R. Soc. Interface 2014 (CC BY 4.0).
7. Zhi & Lien, [arXiv:2005.09476](https://arxiv.org/abs/2005.09476), 2020: learned herding with a roadmap outperforms hand-written rules among obstacles.
8. Robinette et al., [Overtrust of robots in emergency evacuation scenarios](https://pure.psu.edu/en/publications/overtrust-of-robots-in-emergency-evacuation-scenarios/), HRI 2016.
9. LaValle et al., [Motion strategies for maintaining visibility of a moving target](https://cs.stanford.edu/groups/mobots/vis.html), ICRA 1997.
10. Laclau et al., [U-Chain, arXiv:2003.04409](https://arxiv.org/abs/2003.04409), 2020: relay chain of three 12 cm drones underground, positioned by link quality, no GPS.
11. Frew, Lawrence & Morris, [Coordinated standoff tracking of moving targets](https://doi.org/10.2514/1.30507), JGCD 2008.
12. Kim & Sugie, [Cooperative control for target-capturing task based on a cyclic pursuit strategy](https://doi.org/10.1016/j.automatica.2007.01.018), Automatica 2007.
13. Hara, Kim & Hori, [METR 2007-62, University of Tokyo](https://www.keisu.t.u-tokyo.ac.jp/data/2007/METR07-62.pdf), 2007: cyclic pursuit that settles drones at equal angles and a common distance around a target. Cite only; the report must not be reposted.
14. INSARAG, [Guidelines Vol. III, Annex B20: assessment, search and rescue levels](https://insarag.org/wp-content/uploads/2020/04/INSARAG_Guidelines_Vol_III_-_Annex_B20_-_Assessment_Search_and_Rescue_Level.pdf), 2020. New guidelines take effect 1 January 2027.
15. FEMA US&R, [Rescue Specialist Training Manual, Appendix A: marking systems](https://fema.gov/pdf/emergency/usr/appen_a.pdf).
16. Guibas et al., [A visibility-based pursuit-evasion problem](https://lavalle.pl/vispe.html), IJCGA 1999.
17. Wojciechowska et al., [Collocated human–drone interaction: methodology and approach strategy](https://apps4cloud.bgu.ac.il/cauchard/papers/wojciechowska_HRI19.pdf), HRI 2019 (indoor, 24 people).
18. Yamauchi, [A frontier-based approach for autonomous exploration](https://doi.org/10.1109/CIRA.1997.613851), CIRA 1997.
19. Burgard et al., [Coordinated multi-robot exploration](https://doi.org/10.1109/TRO.2004.839232), IEEE T-RO 2005.
20. Zhou, Xu & Shen, [RACER: rapid collaborative exploration with a decentralized multi-UAV system](https://arxiv.org/abs/2209.08533), 2022.
21. McGuire et al., [Minimal navigation solution for a swarm of tiny flying robots to explore an unknown environment](https://doi.org/10.1126/scirobotics.aaw9710), Science Robotics 2019.
22. EASA, [Easy Access Rules for Unmanned Aircraft Systems](https://www.easa.europa.eu/en/downloads/110913/en), guidance to Article 1: indoor operations are outside the regulation.
23. Abioye et al., [arXiv:2409.01768](https://arxiv.org/abs/2409.01768), 2024: indoor comfort zones with one and two drones (18 people).
24. Wögerbauer et al., [Vision 8(4):59](https://pmc.ncbi.nlm.nih.gov/articles/PMC11503297/), 2024: preferred human–drone distances in augmented reality, about 1.6–1.8 m.
25. Yeh et al., [Exploring proxemics for human–drone interaction](https://research.chalmers.se/en/publication/?id=254169), HAI 2017.
26. Duncan & Murphy, [Comfortable approach distance with small UAVs](https://digitalcommons.unl.edu/cseconfwork/240/), RO-MAN 2013.
