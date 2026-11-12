"""Shared geometry description drives both MuJoCo contacts and the web renderer."""
import numpy as np

ARM = 0.19
ROTOR_XY = np.array([[ARM, ARM], [-ARM, ARM], [-ARM, -ARM], [ARM, -ARM]])
SPINS = np.array([1, -1, 1, -1])
YAW_RATIO = 0.018  # reaction torque / thrust, metres
MIXER = np.vstack([np.ones(4), ROTOR_XY[:, 1], -ROTOR_XY[:, 0], SPINS * YAW_RATIO])
MIXER_INV = np.linalg.inv(MIXER)


def make_scene(kind, rng):
    obstacles = []
    def box(x, y, sx, sy, sz, color):
        obstacles.append(dict(kind="box", position=[x, y, sz / 2], size=[sx, sy, sz], color=color))
    def tree(x, y, radius, height):
        obstacles.append(dict(kind="cylinder", position=[x, y, height / 2], size=[radius, height], color="#667354"))
    if kind == "yard":
        for x, y in [(-9, -7), (8, -6), (-8, 7), (9, 8), (0, 10)]:
            box(x + rng.uniform(-.6, .6), y, 4.8, 2.4, 2.6, rng.choice(["#ae684c", "#547a80", "#c5b182"]))
        box(0, -11, 5, 3, 4.5, "#a8aca5")
        box(-1, 4, 1.8, 1.8, 2, "#b79c70")
    elif kind == "warehouse":
        for x in [-10, -5, 5, 10]:
            for y in [-8, 7]:
                box(x, y, 2.6, 4, 5, "#71818a")
        for x in [-16, 16]:
            box(x, 0, .4, 32, 8, "#89918b")
        for y in [-16, 16]:
            box(0, y, 32, .4, 8, "#89918b")
        # Ceiling is a real collider; the viewer can hide it to inspect the room.
        obstacles.append(dict(kind="box", position=[0, 0, 8.2], size=[32, 32, .4], color="#aab0a9", ceiling=True))
    elif kind == "office":
        def item(label,semantic,p,size,color,**properties):
            obstacles.append(dict(kind="box",label=label,semantic=semantic,position=p,size=size,color=color,**properties))
        for x in [-15,15]:item('Side wall','wall',[x,0,2.6],[.3,24,5.2],'#b5b4a4')
        for x in [-8.5,8.5]:item('Entry wall','wall',[x,-12,2.6],[13,.3,5.2],'#b5b4a4')
        item('Door lintel','wall',[0,-12,4.2],[4,.3,2],'#b5b4a4')
        item('Window sill wall','wall',[0,12,.6],[30,.3,1.2],'#b5b4a4')
        item('Window header wall','wall',[0,12,3.95],[30,.3,2.5],'#b5b4a4')
        for x in [-9,9]:item('Window side wall','wall',[x,12,1.95],[12,.3,1.5],'#b5b4a4')
        item('Sofa','sofa',[-7,3,.45],[3,1.1,.9],'#5a7780',cover=True)
        item('Coffee table','table',[-3,3,.425],[1.6,1,.85],'#ae8a5e',climbable=True)
        item('Television','tv',[-7,5,1.1],[2,.15,1.1],'#263239')
        item('Work table','table',[6,6,.5],[2.4,1.2,1.0],'#b2956c',climbable=True)
        item('Storage cabinet','shelf',[-10,-6,1.2],[2,1.2,2.4],'#a6987f',cover=True)
        item('Central divider','wall',[3,4,1.1],[.2,4,2.2],'#b8b7a7',cover=True)
        obstacles.append(dict(kind="box",semantic="ceiling",position=[0,0,5.4],size=[30,24,.3],color="#c9c8b8",ceiling=True))
    else:
        for _ in range(30):
            x, y = rng.uniform(-15, 15, 2)
            if abs(x) < 3 or np.hypot(x, y) < 4:
                continue  # open takeoff / central corridor
            tree(float(x), float(y), float(rng.uniform(.3, .7)), float(rng.uniform(5, 9)))
    for j,o in enumerate(obstacles):
        o.setdefault('semantic','tree' if o['kind']=='cylinder' else 'ceiling' if o.get('ceiling') else 'shelf' if kind=='warehouse' else 'crate' if o['size'][0]<3 else 'container')
        o.setdefault('label',o['semantic'].title()+' '+str(j+1))
        o.setdefault('cover',not o.get('ceiling',False))
    return obstacles


def build_xml(config, obstacles, masses, inertia_scale):
    geoms = ['<geom name="ground" type="plane" size="25 25 .1" friction=".8 .02 .001"/>']
    for j, o in enumerate(obstacles):
        pos = " ".join(map(str, o["position"]))
        if o["kind"] == "box":
            size = " ".join(str(v / 2) for v in o["size"])
            kind = "box"
        else:
            size = f'{o["size"][0]} {o["size"][1] / 2}'
            kind = "cylinder"
        geoms.append(f'<geom name="obstacle{j}" type="{kind}" pos="{pos}" size="{size}"/>')
    bodies, motors = [], []
    for i in range(config.drones):
        inertia = np.array([.018, .018, .032]) * inertia_scale[i] * masses[i] / 1.2
        body = [f'<body name="drone{i}" pos="0 0 3"><freejoint name="joint{i}"/>',
                f'<inertial pos="0 0 0" mass="{masses[i]}" diaginertia="{" ".join(map(str, inertia))}"/>',
                f'<geom name="hull{i}" type="box" size=".14 .11 .06"/>']
        for k, (x, y) in enumerate(ROTOR_XY):
            body.append(f'<geom type="capsule" fromto="0 0 0 {x} {y} 0" size=".025"/>')
            body.append(f'<geom type="sphere" pos="{x} {y} 0" size=".085"/>')
            body.append(f'<site name="rotor{i}_{k}" pos="{x} {y} .025" size=".01"/>')
            motors.append(f'<motor name="motor{i}_{k}" site="rotor{i}_{k}" gear="0 0 1 0 0 {SPINS[k] * YAW_RATIO}" ctrllimited="true" ctrlrange="0 8"/>')
        body.append('</body>')
        bodies.append("".join(body))
    return f'''<mujoco model="swarm_lab"><compiler angle="radian"/>
<option timestep="{1/config.physics_hz}" gravity="0 0 -9.81" integrator="implicitfast" cone="elliptic" iterations="30"/>
<default><geom friction=".7 .01 .001" solref=".008 1" solimp=".95 .99 .001"/></default>
<worldbody><body name="person" mocap="true" pos="0 1 0"><geom name="person_collision" type="capsule" fromto="0 0 .3 0 0 1.5" size=".28"/></body>{"".join(geoms)}{"".join(bodies)}</worldbody><actuator>{"".join(motors)}</actuator></mujoco>'''
