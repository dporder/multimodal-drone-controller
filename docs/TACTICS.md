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
| d_s | standoff from a person = 2.5 m (see "Safety envelope") |
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
  - r = 3.0 m, tightening to d_s while he stalls.
  - At most 0.5 m/s within 4 m of him.
  - **Ethics flag:** approaches from behind are the least comfortable for people [17].
- **Done when:** he is at least 1 m past the exit door, then hold. Failed after 90 s.
- **Swarm Mind fix:** its current `driveout` reuses the keep-out formula. Our branch replaces it with this push.

### Guide out (civil default: evacuation, a lost visitor)
- **Grounding:** in a simulated fire, all 26 participants followed a guide robot, even after seeing it fail. This shows the method works, and also the risk of over-trust [8].
- **Geometry:** the leader flies 3 m ahead on the route to the exit, turned toward him. The followers trail at 3 m and keep line of sight through doors.
- **Done when:** as for drive out.

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
  - Rooms at least 7 m across: a ring of radius 3 m at 120° spacing, rotated to fit the walls.
  - Smaller rooms: one drone just outside each door of his room, with M at the busiest door.
- **Done when:** every drone has held its slot for 3 s. If he is lost: search.

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
  - S1 and S2 each take the nearest uncleared room in the belief set, visit 1–2 viewpoints and spin 360°.
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
  - Drones fly only through known-free cells.
- **Done when:** no reachable frontier of at least 0.5 m² is left.

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
- One drone is uncomfortable under 2 m, moderate at 2–3 m and fine beyond 3 m. Two drones push each zone out by about 1 m [23].
- People prefer a frontal approach at 0.5 m/s, and like approaches from behind least [17].
- Height effects are mixed, so we fly near eye height [24][25][26].

| Limit | Commanded (estimated positions) | Checked in tests (true positions) |
|---|---|---|
| Speed | ≤ 1.5 m/s; ≤ 0.5 m/s in door zones and within 4 m of a person | |
| Separation between drones (horizontal, no stacking) | 1.0 m | ≥ 0.6 m |
| Standoff from people | 2.5 m (3 m when two or more drones are within 4 m) | ≥ 2.0 m |
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
- **Heading:** the direction to his goal, plus a push of k_fear·Σ s_j away from each drone j, plus k_flank around blockers, where s_j = clamp(R_react/d_j − 1, 0, 2).
- **Parameters, hidden from the teacher and drawn per episode:**
  - R_react: 2.5–4.5 m.
  - k_fear: log-uniform 0.5–3.
  - k_flank: 0–1.
  - T_resolve: 10–60 s (patience before giving up).
- **Margin:** a metric-only field records whether a formation could stop him at all, so impossible cases are not counted as teacher errors.
- **Review:** these tactics are grounded but not validated by a practitioner. A review by a search-and-rescue, police or security professional is planned.

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
