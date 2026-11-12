import numpy as np
import mujoco
import pytest
from gymnasium.utils.env_checker import check_env
from swarm_lab import Config, SwarmEnv
from swarm_lab.policy import FormationPolicy
from swarm_lab.scene import MIXER
from swarm_lab.world_model import WorldModel


def calm(**kw):
    return Config(drones=3, wind=0, randomize=False, sensor_noise=0, radio_loss=0,
                  downwash=False, drag=0, **kw)


def test_gravity_matches_analytic_free_fall():
    env=SwarmEnv(calm()); env.reset(seed=1)
    z0=env.q[0,2]
    for _ in range(48):
        mujoco.mj_step(env.model,env.data)
    t=env.data.time
    assert env.v[0,2] == pytest.approx(-9.81*t,abs=1e-7)
    # Semi-implicit integration has a known O(dt) position error.
    assert env.q[0,2] == pytest.approx(z0-.5*9.81*t*t,abs=.005)


def test_equal_rotor_hover_and_quaternion_normalization():
    env=SwarmEnv(calm()); env.reset(seed=2)
    start=env.q.copy()
    env.data.ctrl[:]=env.config.mass*9.81/4
    for _ in range(2400): mujoco.mj_step(env.model,env.data)
    np.testing.assert_allclose(env.q,start,atol=1e-9)
    np.testing.assert_allclose(np.linalg.norm(env.q[:,3:],axis=1),1,atol=1e-12)


def test_rotor_moment_matches_mixer_and_inertia():
    env=SwarmEnv(calm()); env.reset(seed=3)
    thrust=np.array([4.,2.,3.,1.])
    env.data.ctrl[:]=np.tile(thrust,3)
    mujoco.mj_forward(env.model,env.data)
    expected=MIXER@thrust
    inertia=env.model.body_inertia[env.body_ids[0]]
    np.testing.assert_allclose(env.data.qacc[3:6],expected[1:]/inertia,rtol=1e-10,atol=1e-12)
    assert env.data.qacc[2] == pytest.approx(expected[0]/env.config.mass-9.81)


def test_physical_contact_prevents_tunneling_through_floor():
    env=SwarmEnv(calm()); env.reset(seed=4)
    for _ in range(480): mujoco.mj_step(env.model,env.data)
    assert .04 < env.q[0,2] < .12
    assert env.data.ncon > 0
    assert abs(env.v[0,2]) < .01


def test_motor_lag_does_not_instantly_jump_to_command():
    env=SwarmEnv(calm()); env.reset(seed=4)
    before=env.motor_speed.copy()
    env._motors(np.tile([0.,0.,4.],(3,1)))
    target=np.sqrt(env.config.mass*(9.81+4)/4/1.1e-5)
    assert np.all(env.motor_speed > before)
    assert np.all(env.motor_speed < target)


def test_seeded_episodes_are_repeatable():
    env=SwarmEnv(Config(drones=3,seconds=2))
    policy=FormationPolicy()
    runs=[]
    for _ in range(2):
        obs,_=env.reset(seed=88)
        track=[]
        for _ in range(30):
            obs,r,t,tr,_=env.step(policy(obs));track.append(np.r_[env.q.ravel(),obs.ravel(),r])
        runs.append(track)
    np.testing.assert_array_equal(runs[0],runs[1])


def test_gymnasium_contract():
    env=SwarmEnv(Config(drones=3,seconds=2))
    check_env(env,skip_render_check=True)


@pytest.mark.parametrize('scene',['yard','warehouse','forest','office'])
def test_formation_survives_randomized_scene(scene):
    env=SwarmEnv(Config(drones=3,scene=scene,seconds=12))
    obs,_=env.reset(seed=7);env.mode='formation';policy=FormationPolicy()
    for _ in range(360):
        obs,_,done,truncated,info=env.step(policy(obs))
        assert not done, info
    assert truncated
    assert info['formation_error'] < 1.2
    assert info['min_separation'] > .8
    assert info['energy_wh'] > 0
    np.testing.assert_allclose(np.linalg.norm(env.q[:,3:],axis=1),1,atol=1e-10)
    with pytest.raises(RuntimeError): env.step(policy(obs))


def test_collision_terminates_episode():
    env=SwarmEnv(calm());obs,_=env.reset(seed=1)
    env.q[0,2]=.04;mujoco.mj_forward(env.model,env.data)
    _,_,done,_,info=env.step(np.zeros((3,3)))
    assert done and info['reason']=='contact'


def test_invalid_actions_and_parameters():
    with pytest.raises(ValueError):Config(drones=0)
    with pytest.raises(ValueError):Config(wind=float('nan'))
    env=SwarmEnv(calm());env.reset(seed=1)
    with pytest.raises(ValueError):env.step(np.ones(3))
    with pytest.raises(ValueError):env.step(np.full((3,3),np.nan))


def test_lidar_sees_physical_wall():
    env=SwarmEnv(Config(drones=3,scene='warehouse',sensor_noise=0));env.reset(seed=2)
    env.q[0,:3]=[12,0,3];mujoco.mj_forward(env.model,env.data);env._observe()
    assert env.ranges[0,0] == pytest.approx(3.8,abs=1e-6)


def test_world_model_has_heldout_skill_and_roundtrips(tmp_path):
    env=SwarmEnv(Config(drones=3,seconds=10));obs,_=env.reset(seed=9)
    model=WorldModel();policy=FormationPolicy()
    for _ in range(300):
        a=policy(obs);before=env.dynamics_state();obs,_,done,_,_=env.step(a)
        assert not done
        model.update(before,a,env.dynamics_state())
    metrics=model.metrics()
    assert metrics['ready'] and metrics['velocity_rmse'] < metrics['prior_velocity_rmse']
    model.save(tmp_path/'model.npz')
    restored=WorldModel.load(tmp_path/'model.npz')
    np.testing.assert_allclose(model.predict(before,a)[0],restored.predict(before,a)[0])
    paths,uncertainty=model.rollout(env.q[:,:3],env.dynamics_state(),a)
    assert np.array(paths).shape==(16,3,3)
    assert np.all(np.isfinite(paths)) and np.all(np.array(uncertainty)>=0)
