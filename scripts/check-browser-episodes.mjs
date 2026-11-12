import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation} from '../swarm_lab/browser/sim/simulation.js';

const spec=JSON.parse(fs.readFileSync(new URL('../swarm_lab/models/world.json',import.meta.url)));
for(const scene of ['yard','warehouse','forest','office']) {
  const simulation=new Simulation(spec,{scene,seed:7,seconds:300});
  while(!simulation.finished)simulation.step();
  const s=simulation.snapshot({predictions:false});
  assert.equal(s.reason,'time_limit',`${scene} stopped at ${s.time}s: ${s.reason}`);
  assert.equal(s.metrics.collisions,0);
  assert.equal(s.drones.length,3);
  assert.equal(s.person.status,'at destination');
  console.log(`${scene}: ${s.time.toFixed(0)} s, voluntary arrival, ${s.metrics.collisions} contacts, ${s.drones.length} drones`);
}
