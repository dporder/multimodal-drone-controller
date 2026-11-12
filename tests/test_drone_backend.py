import base64
import copy
import json
import numpy as np
import pytest
from swarm_lab.drone_functions import (NeuralNetwork, camera_master, camera_slave1, camera_slave2,
    master_drone, slave1_drone, slave2_drone, neuralnetwork_rotor_master, local_curve,
    curve_from_controls, evaluate_trajectory, master_reference_frame)
from swarm_lab.drone_backend import Controller


def packet():
    drones = [dict(position=[(i-1)*1.7,-3,3.2], velocity=[0,0,0], quaternion=[1,0,0,0],
                   angular_velocity=[0,0,0], goal=[(i-1)*1.7,-3,3.8], battery=1.,
                   ranges=[12.]*12, motors=[2.943]*4) for i in range(3)]
    return dict(session="test",sequence=1,version=1,seed=7,time=0.,mode="guidance",goal=[12,-10,0],
                environment=dict(obstacles=[],wind=[0,0,0]),drones=drones,
                relative_coordinates=[dict(drone=i,position=[i*1.7,0,0],age=0) for i in (1,2)],
                frames=[dict(encoding="rgb8-base64",width=4,height=4,data=base64.b64encode(bytes([60+i*70]*48)).decode(),pose=dict(time=0.,drone=i)) for i in range(3)],
                perception=dict(visible=[True]*3,last_seen=dict(position=[0,-7,0],velocity=[0,0,0],height=1.8,time=0)),
                intruder=dict(intention="inspect site",status="walking independently",mode="autonomous",refused=False,
                              route_pending=True,route_priority=False,path_assigned=False,compliance=1.))


def test_mlp_learns_and_inference_does_not_train():
    net = NeuralNetwork(3,2,7)
    x,target=[.2,-.5,.7],[.3,-.2]
    before=np.linalg.norm(net.predict(x)-target)
    for _ in range(300): net.train(x,target)
    assert np.linalg.norm(net.predict(x)-target)<before*.01
    count=net.samples
    for _ in range(10): net.predict(x)
    assert net.samples==count
    assert not np.allclose(net.w2,0)


def test_three_real_rgb_payloads_have_separate_pose_and_features():
    p=packet()
    cameras=[f(p) for f in (camera_master,camera_slave1,camera_slave2)]
    assert [c["pose"]["drone"] for c in cameras]==[0,1,2]
    assert cameras[0]["image"].shape==(4,4,3)
    assert cameras[0]["features"].mean()<cameras[1]["features"].mean()<cameras[2]["features"].mean()
    p["frames"][0]["data"]="AAAA"
    with pytest.raises(ValueError,match="byte length"): camera_master(p)


def test_named_flight_functions_and_bounded_neural_rotors():
    observation=np.zeros(32);observation[16:28]=12;observation[15]=5;observation[2]=.6
    outputs=[f(observation) for f in (master_drone,slave1_drone,slave2_drone)]
    assert [o["id"] for o in outputs]==[0,1,2]
    net=NeuralNetwork(8,4,470,16);d=packet()["drones"][0]
    for _ in range(300): result=neuralnetwork_rotor_master(net,d,[0,0,0])
    assert result["blend"]==.1
    assert len(result["command"])==4
    assert np.all(np.abs(np.array(result["command"])-2.943)<=.025)


def test_local_curve_rejects_a_corner_cut():
    clear=lambda a,b: not (a[1]>.1 or b[1]>.1)
    curve=local_curve([0,0,3],[0,2,0],[2,0,3],clear)
    assert curve["kind"]=="straight"
    assert len(curve["points"])==21
    assert curve["points"][-1]["position"]==[2.,0.,3.]


def test_controller_is_three_by_four_and_does_not_advance_environment():
    p=packet();before=copy.deepcopy(p)
    controller=Controller(p);response=controller.tick(p)
    assert p==before
    assert np.array(response["rotor_commands"]).shape==(3,4)
    assert len(response["trajectories"])==3
    assert response["modules"]["tactics_network"]["architecture"]=="69 → 24 tanh → 27"
    assert all(t["horizon_seconds"]==1 for t in response["trajectories"])
    assert response["camera_times"]==[0.,0.,0.]
    json.dumps(response,allow_nan=False)
    frame=response["modules"]["master_frame"]
    assert frame["world_origin"]==p["drones"][0]["position"]
    assert frame["master_position"]==[0,0,0]
    assert frame["trajectories"][0]["control_points"][0]==[0,0,0]
    assert frame["axis_alignment"]=="world"
    for i,t in enumerate(response["trajectories"]):
        assert t["drone"]==i and t["generated_at"]==p["time"]
        assert len(t["points"])==21 and np.asarray(t["control_points"]).shape==(4,3)
        assert t["points"][0]["position"]==p["drones"][i]["position"]
        assert t["points"][-1]["t"]==1
        for a,b in zip(t["points"],t["points"][1:]):
            np.testing.assert_allclose(a["delta_position"],np.subtract(b["position"],a["position"]),atol=1e-10)
        assert response["modules"]["drones"][i]["tracking_reference"]==evaluate_trajectory(t,.25)
        local=frame["trajectories"][i]
        np.testing.assert_allclose(np.asarray(local["control_points"])+frame["world_origin"],t["control_points"])
        for a,b in zip(local["points"],t["points"]):
            np.testing.assert_allclose(np.array(a["position"])+frame["world_origin"],b["position"])
            assert a["velocity"]==b["velocity"] and a["acceleration"]==b["acceleration"]


def test_timed_curve_derivatives_and_rotors_follow_interior_not_just_endpoint():
    a=curve_from_controls([[0,0,3],[.4,.4,3],[.7,.5,3],[1,0,3]],lambda a,b:True)
    b=curve_from_controls([[0,0,3],[.4,-.4,3],[.7,-.5,3],[1,0,3]],lambda a,b:True)
    assert a["target"]==b["target"]
    t,h=.4,1e-5
    previous,current,following=[evaluate_trajectory(a,x) for x in (t-h,t,t+h)]
    np.testing.assert_allclose((np.array(following["position"])-previous["position"])/(2*h),current["velocity"],atol=1e-8)
    np.testing.assert_allclose((np.array(following["velocity"])-previous["velocity"])/(2*h),current["acceleration"],atol=1e-8)
    commands=[]
    for curve in (a,b):
        ref=evaluate_trajectory(curve,.25)
        observation=np.zeros(32);observation[:3]=np.array(ref["position"])-[0,0,3];observation[16:28]=12;observation[15]=5
        flight=master_drone(observation,trajectory=curve)
        commands.append(neuralnetwork_rotor_master(NeuralNetwork(8,4,7,16),packet()["drones"][0],flight["acceleration"])["command"])
    assert not np.allclose(commands[0],commands[1])


def test_hidden_actor_coordinates_cannot_change_master_plan():
    p=packet();p["perception"]["visible"]=[False]*3;p["time"]=2
    for f in p["frames"]:f["pose"]["time"]=2
    p["intruder"]["position"]=[9,9,0]
    a=Controller(p).tick(p)
    p["intruder"]["position"]=[-9,-9,0]
    b=Controller(p).tick(p)
    assert a["goals"]==b["goals"]
    assert a["rotor_commands"]==b["rotor_commands"]


def test_camera_timestamp_and_rotor_quaternion_are_validated():
    p=packet();p["frames"][0]["pose"]["time"]=.5
    with pytest.raises(ValueError,match="identity/time"):camera_master(p)
    d=packet()["drones"][0];d["quaternion"]=[0,0,0,0]
    with pytest.raises(ValueError,match="Zero quaternion"):
        neuralnetwork_rotor_master(NeuralNetwork(8,4),d,[0,0,0])


def test_reference_origin_remains_fixed_when_master_moves():
    p=packet();p["reference_origin"]=[-1.7,-3,3.2];controller=Controller(p)
    initial=controller.tick(p)["modules"]["master_frame"]
    p["time"]=.05
    for f in p["frames"]:f["pose"]["time"]=.05
    for d in p["drones"]:d["position"][0]+=.2
    moved=controller.tick(p)["modules"]["master_frame"]
    assert initial["world_origin"]==moved["world_origin"]==[-1.7,-3,3.2]
    assert moved["origin_at"]=="episode_start"
    assert abs(moved["master_position"][0]-.2)<1e-8
    np.testing.assert_allclose(np.array(moved["trajectories"][0]["control_points"][0])+moved["world_origin"],p["drones"][0]["position"])


def test_rotor_rate_damping_uses_body_frame_under_rotated_attitude():
    d=packet()["drones"][0];d["quaternion"]=[2**-.5,0,0,2**-.5];d["angular_velocity"]=[.2,-.1,.3]
    net=NeuralNetwork(8,4,7,16)
    captured=[];predict=net.predict
    net.predict=lambda x:(captured.append(np.array(x)),predict(x))[1]
    result=neuralnetwork_rotor_master(net,d,[0,0,0])
    np.testing.assert_allclose(captured[0][4:7],np.array(d["angular_velocity"])/5)
    torque=np.array([-.14*.2,.14*.1,-.35-.12*.3])
    arms=np.array([[.19,.19],[-.19,.19],[-.19,-.19],[.19,-.19]])
    expected=np.clip(2.943+arms[:,1]*torque[0]/(4*.19**2)-arms[:,0]*torque[1]/(4*.19**2)+np.array([1,-1,1,-1])*torque[2]/(4*.018),0,7)
    np.testing.assert_allclose(result["teacher_command"],expected)


def test_bad_observation_is_rejected_before_learning_or_advancing_map():
    p=packet();controller=Controller(p);controller.tick(p)
    samples=controller.tactics_net.samples
    for field,value in [("quaternion",[0,0,0,0]),("velocity",[float('nan'),0,0]),("angular_velocity_frame","world")]:
        bad=copy.deepcopy(p);bad["drones"][1][field]=value
        with pytest.raises(ValueError):controller.tick(bad)
        assert controller.tactics_net.samples==samples
    bad=copy.deepcopy(p);bad["perception"]["last_seen"]["time"]=1
    with pytest.raises(ValueError,match="Future sighting"):controller.tick(bad)
    assert controller.tactics_net.samples==samples
