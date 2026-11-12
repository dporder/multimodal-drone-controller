import copy
import numpy as np
from swarm_lab.controller_geometry import segment_hits,path_separation
from swarm_lab.drone_functions import curve_from_controls
from swarm_lab.trajectory_safety import coordinate_trajectories,braking_curve,certify
from test_drone_backend import packet
from swarm_lab.drone_backend import Controller


def test_vertical_cylinder_caps_and_body_margin_are_checked():
    trunk=dict(kind="cylinder",position=[0,0,3],size=[.3,6])
    assert segment_hits([0,0,8],[0,0,5],trunk)
    assert segment_hits([.5,0,8],[.5,0,5],trunk,.3)
    assert not segment_hits([1,0,8],[1,0,5],trunk,.3)


def test_continuous_separation_finds_crossing_between_samples():
    a=dict(points=[dict(position=[-1,0,3]),dict(position=[1,0,3])])
    b=dict(points=[dict(position=[0,-1,3]),dict(position=[0,1,3])])
    assert path_separation(a,b)<1e-8


def test_braking_keeps_measured_initial_velocity_and_does_not_claim_blocked_space_safe():
    c=dict(position=np.array([0.,0.,3.]),velocity=np.array([2.,0.,0.]),speed=2.)
    curve=braking_curve(c,lambda a,b:False)
    np.testing.assert_allclose(curve["points"][0]["velocity"],c["velocity"])
    check=certify(curve,c,lambda a,b:False);assert check["continuous_velocity"] and not check["geometry_clear"]


def test_crossing_reservations_are_resolved_or_explicitly_reported():
    contexts=[dict(position=np.array(p,float),velocity=np.array(v,float),speed=2.) for p,v in [([-1,0,3],[2,0,0]),([0,-1,3],[0,2,0]),([5,5,3],[0,0,0])]]
    curves=[]
    for c in contexts:
        p,v=c["position"],c["velocity"];curves.append(curve_from_controls([p,p+v/3,p+2*v/3,p+v],lambda a,b:True))
    result,diagnostics=coordinate_trajectories(curves,contexts,lambda a,b:True)
    assert diagnostics["reservation_interventions"]>0 or diagnostics["unresolved"]>0
    assert all(c["validation"]["continuous_velocity"] for c in result)
    assert all(c["validated"]==(c["validation"]["geometry_clear"] and c["validation"]["dynamics_feasible"] and c["validation"]["separation_clear"]) for c in result)


def test_observed_mode_is_invariant_to_unseen_ground_truth_and_retries_do_not_train_twice():
    p=packet();p["environment"]["map_source"]="observed";p["environment"]["observed_map"]={"revision":0,"objects":[]}
    first=Controller(p);a=first.tick(p);samples=first.tactics_net.samples
    p["sequence"]+=1;again=first.tick(p);assert first.tactics_net.samples==samples;assert again["sequence"]==p["sequence"]
    changed=copy.deepcopy(p);changed["environment"]["obstacles"]=[dict(kind="box",position=[0,-5,3],size=[4,4,6],label="Unseen",semantic="building")]
    b=Controller(changed).tick(changed);assert a["goals"]==b["goals"];assert a["rotor_commands"]==b["rotor_commands"]
