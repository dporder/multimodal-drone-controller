from swarm_lab import Config,SwarmEnv
from swarm_lab.knowledge import graph, SPEC


def test_graph_is_linked_and_matches_live_three_drone_world():
    e=SwarmEnv(Config(scene='office'));e.reset(seed=7)
    g=graph(e)
    ids=[n['id'] for n in g['nodes']]
    assert len(ids)==len(set(ids))
    assert all(edge['source'] in ids and edge['target'] in ids for edge in g['edges'])
    assert len([n for n in g['nodes'] if n['kind']=='agent' and n['layer']=='swarm'])==3
    assert len([n for n in g['nodes'] if n['kind']=='actuator'])==12
    assert {'person','swarm','environment'}==set(n['layer'] for n in g['nodes'])
    assert all(t in ids for t in ['type:door','type:window','type:sofa','type:table','type:tv','type:hall'])
    assert any(o.get('climbable') for o in e.obstacles)
    assert SPEC['units']['world_up']=='Z'


def test_visibility_is_blocked_by_geometry_not_actor_labels():
    import mujoco
    import numpy as np
    e=SwarmEnv(Config(scene='office',sensor_noise=0));e.reset(seed=7)
    e.q[:,:3]=[[1,3,1.5],[-2,2,1.5],[-2,4,1.5]]
    e.actor.position[:]=[4,4,0];e.data.mocap_pos[0]=e.actor.position
    mujoco.mj_forward(e.model,e.data);e._observe()
    assert not any(e.person_visible)
    e.actor.position[:]=[0,0,0];e.data.mocap_pos[0]=e.actor.position
    mujoco.mj_forward(e.model,e.data);e._observe()
    assert any(e.person_visible)
    assert e.last_seen['position']==[0,0,0]
