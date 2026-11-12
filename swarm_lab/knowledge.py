"""Typed world specification and live knowledge-graph projection.

The graph separates ground-truth state, observed state, affordances and policy.
It is a semantic model of this simulator, not a claim of human-behavior fidelity.
"""
import json
from pathlib import Path

SPEC = json.loads((Path(__file__).parent/'models'/'world.json').read_text())
PERSON_SPEC = next(x for x in SPEC['object_types'] if x['id']=='person')


def graph(env):
    nodes,edges=[],[]
    def node(id,layer,kind,label,properties=None):
        nodes.append(dict(id=id,layer=layer,kind=kind,label=label,properties=properties or {}))
    def edge(a,b,relation):edges.append(dict(source=a,target=b,relation=relation))
    for layer in SPEC['layers']:node(layer['id'],layer['id'],'layer',layer['label'],layer)
    for t in SPEC['object_types']:
        layer=t['id'] if t['id']=='person' else 'swarm' if t['id']=='drone' else 'environment'
        node('type:'+t['id'],layer,'type',t['label'],t);edge('type:'+t['id'],layer,'PART_OF')
    for law in SPEC['laws']:
        node('law:'+law['id'],law['layer'],'law',law['id'].replace('_',' '),law)
        edge(law['layer'],'law:'+law['id'],'GOVERNED_BY')
    for action in SPEC['actions']:
        node('action:'+action['id'],action['layer'],'action',action['id'].replace('_',' '),action)
        edge(action['layer'],'action:'+action['id'],'CAN_PERFORM')
    node('actor','person','agent','Person',env.actor.snapshot());edge('actor','type:person','IS_A')
    node('destination','environment','goal','Exit / destination',dict(position=env.destination.tolist()))
    node('person_goal','person','goal','Person’s chosen goal',dict(position=env.actor.goal.tolist(),intention=env.actor.intention))
    edge('actor','person_goal','HAS_GOAL')
    edge('swarm','destination','INDICATES_ROUTE_TO')
    node('ground','environment','object','Ground',dict(position=[0,0,0],friction=.8))
    edge('ground','type:ground','IS_A');edge('ground','actor','SUPPORTS')
    for i,d in enumerate(env.snapshot()['drones']):
        id=f'drone:{i}';node(id,'swarm','agent',f'Drone {i+1}',d);edge(id,'type:drone','IS_A');edge(id,'swarm','PART_OF')
        edge(id,'actor','AVOIDS')
        if env.person_visible[i]:edge(id,'actor','OBSERVES')
        for j in range(3):
            if i!=j:edge(id,f'drone:{j}','COMMUNICATES_WITH')
        for k,force in enumerate(d['motors']):
            rotor=f'{id}:rotor:{k}';node(rotor,'swarm','actuator',f'D{i+1} / rotor {k+1}',dict(thrust_N=force));edge(rotor,id,'PART_OF')
    for j,o in enumerate(env.obstacles):
        id=f'object:{j}';semantic=o.get('semantic','tree' if o['kind']=='cylinder' else 'ceiling' if o.get('ceiling') else 'container')
        node(id,'environment','object',o.get('label',f'{semantic.title()} {j+1}'),o);edge(id,'type:'+semantic,'IS_A');edge(id,'environment','PART_OF')
        edge(id,'actor','BLOCKS');edge(id,'swarm','OCCLUDES')
        if o.get('climbable'):edge(id,'action:climb_low_surface','SUPPORTS')
    if env.config.scene=='office':
        for id,kind,label,pos in [('door:1','door','Open entry doorway',[0,-12,0]),('window:1','window','Open observation window',[0,12,2]),('room:1','room','Furnished room',[0,2,0]),('hall:1','hall','Central aisle',[0,-5,0])]:
            node(id,'environment','region',label,dict(position=pos));edge(id,'type:'+kind,'IS_A');edge(id,'environment','PART_OF')
        edge('door:1','hall:1','CONNECTS');edge('hall:1','room:1','CONNECTS')
    return dict(schema_version=1,units=SPEC['units'],invariants=SPEC['invariants'],time=float(env.data.time),nodes=nodes,edges=edges)
